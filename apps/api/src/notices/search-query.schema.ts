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
 * `SearchNoticesSchema` with `lat`/`lng` hardened for query-string input.
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
});

/**
 * Compile-time drift guard: the guarded query schema must still produce exactly
 * the contract's `SearchNotices`, so `NoticesService.search` keeps taking the
 * shared type. If a future edit here changes an output field, this annotation
 * fails to compile rather than silently handing the repository a different shape.
 */
export const _searchQueryMatchesContract: (q: z.infer<typeof SearchNoticesQuerySchema>) => SearchNotices =
  (q) => q;
