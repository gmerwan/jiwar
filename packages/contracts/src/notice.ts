import { z } from "zod";
import { CategorySchema } from "./category.js";

export const ATTENDANCE_VALUES = ["public", "invitation_only", "restricted"] as const;
export const AttendanceSchema = z.enum(ATTENDANCE_VALUES);
export type Attendance = z.infer<typeof AttendanceSchema>;

export const NOTICE_STATUS_VALUES = ["published", "cancelled", "removed"] as const;
export const NoticeStatusSchema = z.enum(NOTICE_STATUS_VALUES);
export type NoticeStatus = z.infer<typeof NoticeStatusSchema>;

/**
 * A string that is unambiguously a decimal number, and nothing else.
 *
 * Deliberately stricter than `Number()`, which is the whole point of this fix.
 * `Number` accepts several spellings that no caller of a coordinate API means:
 * `""` and `"  "` become `0`, `"0x10"` becomes `16`, `"Infinity"` becomes
 * `Infinity`. Only a plain optionally-signed decimal, with an optional exponent,
 * is treated as a number here. Surrounding whitespace is tolerated because a query
 * string or a form field can carry it around a value the user really did type.
 *
 * `1e-7` and `.5` are accepted: a geocoder legitimately returns coordinates in
 * exponent form, and a leading-dot decimal is what some keyboards produce.
 */
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Maps anything that is not actually a number to `undefined`, so the validator
 * downstream rejects it instead of silently coercing it to `0`.
 *
 * This is the Null Island bug, closed at its source. `LatitudeSchema` was a bare
 * `z.coerce.number().min(-90).max(90)`, and `z.coerce` calls `Number()`, which
 * returns **`0`** — a perfectly valid latitude that clears every bound — for a
 * whole family of blank-ish inputs. Measured against the compiled contract before
 * this preprocess existed:
 *
 *   CreateNoticeSchema.parse({ lat: null,  ... })  -> lat = 0
 *   CreateNoticeSchema.parse({ lat: "",    ... })  -> lat = 0
 *   CreateNoticeSchema.parse({ lat: false, ... })  -> lat = 0
 *   CreateNoticeSchema.parse({ lat: [],    ... })  -> lat = 0   (Number([]) === 0)
 *
 * All four were POSTed to a live API and answered **201**, landing rows at (0, 0)
 * in the Gulf of Guinea that a later search then returned as real notices. There
 * was no error anywhere in the chain — the wrong answer was the successful one.
 *
 * The guard lives on the shared coordinate schemas rather than per-route because
 * six consumers share them: the create body, the search query, and
 * `reverse-geocode` all inherited the same hazard, and the browser-side picker in
 * `apps/web` was the only thing standing in front of it — which is no defence at
 * all for a non-browser client posting JSON directly.
 *
 * **A real zero still parses.** `0`, `-0` and `"0"` are numbers and are returned
 * untouched, because the equator and the prime meridian are places: someone may
 * legitimately search or publish at 0°. The bug is never that zero is invalid, only
 * that *blankness* was being spelled as zero. Every rejection below is of a value
 * that carries no number at all.
 */
function numericOrUndefined(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value === "string" && DECIMAL_NUMBER.test(value.trim())) return value.trim();
  // Everything else — null, undefined, "", whitespace, false, true, [], {},
  // "abc", "0x10", bigints, a one-element array — becomes a missing value, which
  // the `z.coerce.number()` behind this preprocess reports as `invalid_type`
  // rather than accepting as 0.
  return undefined;
}

/**
 * Latitude in degrees, ±90.
 *
 * Still `z.coerce.number()` underneath, so a query string's `"36.75"` keeps
 * working; the preprocess above only removes the inputs that were never numbers.
 * The declared input type is unchanged (`unknown` either way), so no consumer's
 * types move.
 */
export const LatitudeSchema = z.preprocess(numericOrUndefined, z.coerce.number().min(-90).max(90));

/** Longitude in degrees, ±180. See `LatitudeSchema` for why the preprocess is there. */
export const LongitudeSchema = z.preprocess(
  numericOrUndefined,
  z.coerce.number().min(-180).max(180),
);

export const CreateNoticeBase = z.object({
  categorySlug: z.string().min(1),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).default(""),
  venueName: z.string().trim().min(1).max(160),
  address: z.string().trim().min(1).max(400),
  lat: LatitudeSchema,
  lng: LongitudeSchema,
  startsAt: z.iso.datetime(),
  attendance: AttendanceSchema,
  organizerName: z.string().trim().max(160).optional(),
  organizerContact: z.string().trim().max(160).optional(),
  organizerConsent: z.boolean().default(false),
});

/**
 * A NUL byte (`U+0000`) anywhere in a string.
 *
 * Postgres rejects NUL inside `text` at the protocol level, so parameterisation is
 * no defence: the driver raises `invalid byte sequence for encoding "UTF8": 0x00`
 * (SQLSTATE 22021) and the request becomes a **500**. Measured against a live API,
 * `POST /v1/notices` with `{"title":"a\u0000b", ...}` returned 500 rather than the
 * 400 it is — the body is malformed, which is the client's mistake.
 *
 * The 500 also amplified: the error handler logged the failing SQL plus every bound
 * parameter, so a 4 KB body produced roughly 11.6 KB of log per unauthenticated
 * request. That makes it a cheap disk-fill vector as well as a wrong status code.
 *
 * Task 8 closed the same hole on the query string (`categories`) and Task 7 on the
 * cursor tiebreaker; this closes it for the create body's free-form text.
 */
const NUL_BYTE = /\u0000/;

/** The same guard on every free-form string that is stored in a `text`/`varchar` column. */
function rejectNulByte<T extends z.ZodType>(schema: T): T {
  return schema.check((ctx) => {
    if (typeof ctx.value === "string" && NUL_BYTE.test(ctx.value)) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message: "must not contain a NUL byte",
      });
    }
  }) as T;
}

/**
 * The create-notice body: `CreateNoticeBase` plus the organizer-consent rule and a
 * NUL-byte guard on every text field that reaches SQL.
 *
 * `safeExtend` rather than `extend`: zod 4 refuses to overwrite a key on an object
 * schema that already carries a refinement, and the consent `.refine()` below is
 * applied to the *extended* object precisely so a later reader cannot reorder the
 * two and quietly drop it. The guards are chained onto each field's own contract
 * schema, so the accepted input, the trimming, the length caps and the
 * `description` default all stay exactly as declared above — only NUL is newly
 * refused. `lat`/`lng` need no guard: they are numbers by the time anything is
 * bound.
 */
export const CreateNoticeSchema = CreateNoticeBase.safeExtend({
  categorySlug: rejectNulByte(CreateNoticeBase.shape.categorySlug),
  title: rejectNulByte(CreateNoticeBase.shape.title),
  description: rejectNulByte(CreateNoticeBase.shape.description),
  venueName: rejectNulByte(CreateNoticeBase.shape.venueName),
  address: rejectNulByte(CreateNoticeBase.shape.address),
  organizerName: rejectNulByte(CreateNoticeBase.shape.organizerName),
  organizerContact: rejectNulByte(CreateNoticeBase.shape.organizerContact),
}).refine((v) => !v.organizerContact || v.organizerConsent === true, {
  message: "Organizer consent is required before publishing organizer contact details.",
  path: ["organizerConsent"],
});

export type CreateNotice = z.infer<typeof CreateNoticeSchema>;

export const NoticeSchema = z.object({
  publicId: z.string().min(1),
  category: CategorySchema,
  title: z.string(),
  description: z.string(),
  venueName: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  startsAt: z.iso.datetime(),
  attendance: AttendanceSchema,
  organizerName: z.string().nullable(),
  organizerContact: z.string().nullable(),
  status: NoticeStatusSchema,
  isPast: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type Notice = z.infer<typeof NoticeSchema>;
