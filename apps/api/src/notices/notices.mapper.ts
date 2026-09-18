import type { Notice, NoticeWithDistance } from "@jiwar/contracts";

/**
 * A timestamp as it can arrive from either query path.
 *
 * Drizzle's query builder hands back a `Date`, but a raw `db.execute()` hands back
 * a **string**: `drizzle-orm/postgres-js/driver.js` installs transparent (identity)
 * parsers over postgres-js's own for every date/time OID (1184, 1114, 1082, ...),
 * and raw SQL carries no column metadata for Drizzle to re-apply a decoder from.
 * Measured on this schema: `SELECT n.starts_at` through `db.execute` yields the
 * string `"2026-09-18 21:51:01.237+00"`, and calling `.toISOString()` on it throws
 * `TypeError: row.startsAt.toISOString is not a function`.
 *
 * The union is deliberately permissive rather than narrowed to `string`: a caller
 * that already holds a real `Date` (the query builder, or a unit test) still
 * type-checks, so this widening cannot break an existing producer of a `NoticeRow`.
 */
export type RowTimestamp = Date | string;

/**
 * Normalises a row timestamp to a `Date`.
 *
 * Postgres' output format (`"2026-09-18 21:51:01.237+00"`) is not ISO 8601: the
 * date and time are space-separated and the zone offset has no minutes. V8 happens
 * to parse it anyway, but that tolerance is implementation-defined and not
 * guaranteed by the spec, so the string is rewritten into a strict ISO form before
 * parsing rather than trusted as-is. An unparseable value throws instead of
 * yielding `Invalid Date`, which would otherwise surface much later as a
 * `null` `startsAt` in an API response.
 */
function toDate(value: RowTimestamp): Date {
  if (value instanceof Date) return value;
  const iso = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unparseable timestamp from the database: ${value}`);
  }
  return parsed;
}

/**
 * One joined notice+category row as the raw SQL in the repository selects it.
 *
 * A `type` alias rather than an `interface`, and that is load-bearing: Drizzle types
 * `db.execute<TRow extends Record<string, unknown>>`, and TypeScript grants an
 * implicit index signature to a type alias of an object literal but **not** to an
 * interface. Declared as an interface (as the task brief had it) both call sites
 * fail to compile with `TS2344: Type 'NoticeRow' does not satisfy the constraint
 * 'Record<string, unknown>'. Index signature for type 'string' is missing`.
 * Verified against this repo's TypeScript 6.0.2.
 *
 * Adding an index signature to an interface would also compile, but it would let any
 * misspelled property through on every row object, so the alias is the narrower fix.
 * The exported name is unchanged, and a type alias is still importable, extendable by
 * intersection, and usable in an `extends` clause, so downstream consumers see no
 * difference.
 */
export type NoticeRow = {
  publicId: string;
  title: string;
  description: string;
  venueName: string;
  address: string;
  lat: number;
  lng: number;
  startsAt: RowTimestamp;
  attendance: "public" | "invitation_only" | "restricted";
  organizerName: string | null;
  organizerContact: string | null;
  status: "published" | "cancelled" | "removed";
  createdAt: RowTimestamp;
  categorySlug: string;
  categoryName: string;
  categoryIcon: string;
  categorySortOrder: number;
  distanceMetres?: number;
};

/** A notice without a distance, for the detail endpoint where there is no search origin. */
export function toNotice(row: NoticeRow, pastGraceHours: number): Notice {
  const graceMs = pastGraceHours * 60 * 60 * 1000;
  const startsAt = toDate(row.startsAt);
  return {
    publicId: row.publicId,
    category: {
      slug: row.categorySlug,
      name: row.categoryName,
      icon: row.categoryIcon,
      sortOrder: row.categorySortOrder,
    },
    title: row.title,
    description: row.description,
    venueName: row.venueName,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    startsAt: startsAt.toISOString(),
    attendance: row.attendance,
    organizerName: row.organizerName,
    organizerContact: row.organizerContact,
    status: row.status,
    isPast: startsAt.getTime() + graceMs < Date.now(),
    createdAt: toDate(row.createdAt).toISOString(),
  };
}

export function toNoticeWithDistance(row: NoticeRow, pastGraceHours: number): NoticeWithDistance {
  const graceMs = pastGraceHours * 60 * 60 * 1000;
  const startsAt = toDate(row.startsAt);
  return {
    publicId: row.publicId,
    category: {
      slug: row.categorySlug,
      name: row.categoryName,
      icon: row.categoryIcon,
      sortOrder: row.categorySortOrder,
    },
    title: row.title,
    description: row.description,
    venueName: row.venueName,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    startsAt: startsAt.toISOString(),
    attendance: row.attendance,
    organizerName: row.organizerName,
    organizerContact: row.organizerContact,
    status: row.status,
    isPast: startsAt.getTime() + graceMs < Date.now(),
    createdAt: toDate(row.createdAt).toISOString(),
    distanceMetres: Math.round(row.distanceMetres ?? 0),
  };
}
