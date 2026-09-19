import {
  LatitudeSchema,
  LongitudeSchema,
  SearchNoticesSchema,
  type SearchNotices,
} from "@jiwar/contracts";
import { z } from "zod";

/**
 * True for a value a caller never actually supplied a number for.
 *
 * `undefined` and `null` are the missing cases; a string that trims to empty is
 * the one a browser produces. Deliberately NOT treated as blank: the string
 * `"0"`, the number `0`, or a `lat=0` a caller typed on purpose — the equator and
 * the prime meridian are real coordinates and must keep working.
 */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Rejects a blank value before handing it to `inner`.
 *
 * The bug this closes: `LatitudeSchema` is `z.coerce.number().min(-90).max(90)`,
 * and `Number("")` and `Number(null)` are both **`0`** — a valid latitude that
 * passes every bound. Measured against the compiled contract before this guard:
 *
 *   SearchNoticesSchema.parse({ lat: "", lng: "3" })  -> { lat: 0,  lng: 3 }
 *   SearchNoticesSchema.parse({ lat: "", lng: "" })   -> { lat: 0,  lng: 0 }
 *   SearchNoticesSchema.parse({ lat: null, lng: 3 })  -> { lat: 0,  lng: 3 }
 *
 * `?lat=&lng=` is exactly what a browser submits for an empty form field, so a
 * visitor whose geolocation never resolved would have searched from (0, 0) —
 * open ocean in the Gulf of Guinea — and been told "no notices near you" instead
 * of being told their coordinates were missing. A silent wrong answer, not an
 * error. Note that a *missing* `lat` already failed (`Number(undefined)` is
 * `NaN`), which is why the empty-string case went unnoticed: the obvious test
 * passes without this guard.
 *
 * `z.unknown().check(...).pipe(inner)` is used rather than a `.refine()` on the
 * object, because the check has to run **before** coercion — once `z.coerce`
 * has turned `""` into `0` the original emptiness is unrecoverable.
 *
 * The guard lives here, at the HTTP boundary, rather than in
 * `packages/contracts`: six tasks import `SearchNoticesSchema`, and tightening
 * its *input* type to `unknown` there would ripple into Task 10's typed client
 * and every other consumer. Coercion from a query string is an HTTP concern, so
 * the query-string hazard is fixed in the layer that owns query strings.
 *
 * `.meta()` restores the OpenAPI shape that `zod-openapi` cannot infer through a
 * `z.unknown()` pipe — without it `/api/docs` renders `lat` as a bare `{}`
 * (verified), losing the number type and the ±90/±180 bounds.
 */
function requiredCoordinate(
  inner: typeof LatitudeSchema,
  field: "lat" | "lng",
  meta: Record<string, unknown>,
) {
  return z
    .unknown()
    .check((ctx) => {
      if (isBlank(ctx.value)) {
        ctx.issues.push({
          code: "custom",
          input: ctx.value,
          path: [],
          message: `${field} is required and must be a number`,
        });
      }
    })
    .pipe(inner)
    .meta(meta);
}

/**
 * A NUL byte (`U+0000`) anywhere in a string.
 *
 * Postgres rejects NUL inside `text` at the protocol level, so parameterisation
 * is no defence: the driver raises `invalid byte sequence for encoding "UTF8":
 * 0x00` (SQLSTATE 22021) and the request becomes a 500. Task 7 guarded the cursor
 * tiebreaker for exactly this reason, and its comment anticipated that it would
 * matter "once Task 8 exposes `?cursor=`" — but the guard was per-field, so the
 * new inputs this task exposes were never covered.
 *
 * `categories` is the one *query* field that needs it. Measured against a live
 * server, `?categories=a%00b` returned 500, while `lat`, `lng`, `radiusKm`,
 * `limit`, `when` and `sort` all returned a clean 400 — their number and enum
 * validators reject a NUL before it can reach a bound parameter. `categories` is
 * the only free-form `z.string()` in the query that is passed through to SQL.
 */
const NUL_BYTE = /\u0000/;

/**
 * `SearchNoticesSchema` with `lat`/`lng` hardened for query-string input, and
 * `categories` guarded against a NUL byte.
 *
 * Every other field, and every default, comes from the shared contract, so the
 * accepted query string cannot drift from what Task 10's client sends.
 */
export const SearchNoticesQuerySchema = SearchNoticesSchema.extend({
  lat: requiredCoordinate(LatitudeSchema, "lat", {
    type: "number",
    minimum: -90,
    maximum: 90,
    description: "Latitude of the search origin.",
  }),
  lng: requiredCoordinate(LongitudeSchema, "lng", {
    type: "number",
    minimum: -180,
    maximum: 180,
    description: "Longitude of the search origin.",
  }),
  // Checked *after* the contract's own union-and-transform has normalised one
  // slug or many into an array, so a single `?categories=a%00b` and one bad entry
  // among several are both caught by the same test. Chaining `.check()` onto the
  // contract's field rather than redeclaring it keeps the accepted input, the
  // transform and the OpenAPI `anyOf` shape exactly as the contract defines them
  // (verified: the rendered schema is unchanged).
  categories: SearchNoticesSchema.shape.categories.check((ctx) => {
    if (Array.isArray(ctx.value) && ctx.value.some((slug) => NUL_BYTE.test(slug))) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        path: [],
        message: "categories must not contain a NUL byte",
      });
    }
  }),
});

/**
 * Compile-time drift guard: the guarded query schema must still produce exactly
 * the contract's `SearchNotices`, so `NoticesService.search` keeps taking the
 * shared type. If a future edit here changes an output field, this annotation
 * fails to compile rather than silently handing the repository a different shape.
 */
export const _searchQueryMatchesContract: (q: z.infer<typeof SearchNoticesQuerySchema>) => SearchNotices =
  (q) => q;

/**
 * Every character a `public_id` can legitimately contain, and nothing else.
 *
 * Deliberately the same pattern the repository already applies to a cursor's
 * tiebreaker (`CURSOR_TIEBREAKER_PATTERN`), because it describes the same values:
 * a `public_id` is a `nanoid(12)` stored in a `varchar(16)`, and `nanoid`'s
 * alphabet is exactly `A-Za-z0-9_-`. Keeping the two identical means a future
 * change to the id format has one obvious shape to update rather than two that
 * can silently diverge.
 *
 * Why this is a guard and not merely tidiness: `publicId` is an unvalidated path
 * parameter that reaches postgres as a bound parameter in both
 * `findByPublicId` and `cancel`. Measured against a live server before this
 * guard, `GET /v1/notices/a%00b` and `POST /v1/notices/a%00b/cancel` both
 * returned **500** — `PostgresError: invalid byte sequence for encoding "UTF8":
 * 0x00`, SQLSTATE 22021, `where: 'unnamed portal parameter $3'` — because
 * Postgres rejects a NUL inside `text` at the protocol level, so binding the
 * parameter does not help. The 500 also put the failing SQL and every bound
 * parameter into the server log on each occurrence. The length cap additionally
 * bounds the payload: a multi-kilobyte id was previously bound and sent, and no
 * value over 16 characters can ever match a row.
 */
export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;

/** True for a path id that could never identify a row, so it must not reach SQL. */
export function isWellFormedPublicId(publicId: string): boolean {
  return PUBLIC_ID_PATTERN.test(publicId);
}
