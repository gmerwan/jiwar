import { describe, expect, it } from "vitest";
import { CreateNoticeSchema } from "./notice.js";

const valid = {
  categorySlug: "funeral",
  title: "Funeral prayer for the late Ahmed Benali",
  description: "Prayer will be held after Dhuhr.",
  venueName: "Masjid Al-Rahma",
  address: "Rue Didouche Mourad, Algiers",
  lat: 36.75,
  lng: 3.06,
  startsAt: "2026-10-01T12:30:00.000Z",
  attendance: "public" as const,
};

describe("CreateNoticeSchema", () => {
  it("accepts a valid notice", () => {
    expect(CreateNoticeSchema.parse(valid).title).toBe(valid.title);
  });

  it("trims the title and rejects one that is blank or too short", () => {
    expect(CreateNoticeSchema.parse({ ...valid, title: "  Hello there  " }).title).toBe("Hello there");
    expect(() => CreateNoticeSchema.parse({ ...valid, title: "   " })).toThrow();
    expect(() => CreateNoticeSchema.parse({ ...valid, title: "ab" })).toThrow();
  });

  it("rejects an invalid attendance value", () => {
    expect(() => CreateNoticeSchema.parse({ ...valid, attendance: "maybe" })).toThrow();
  });

  it("requires organizerConsent when organizerContact is given", () => {
    expect(() =>
      CreateNoticeSchema.parse({ ...valid, organizerContact: "+213 555 0000", organizerConsent: false }),
    ).toThrow(/consent/i);

    const ok = CreateNoticeSchema.parse({
      ...valid,
      organizerContact: "+213 555 0000",
      organizerConsent: true,
    });
    expect(ok.organizerContact).toBe("+213 555 0000");
  });

  it("does not require consent when no organizer contact is given", () => {
    expect(() => CreateNoticeSchema.parse({ ...valid, organizerConsent: false })).not.toThrow();
  });
});

/**
 * The Null Island guard on the shared coordinate schemas.
 *
 * `LatitudeSchema` was a bare `z.coerce.number().min(-90).max(90)`, and `z.coerce`
 * is `Number()`, which returns **`0`** — a legal latitude clearing every bound —
 * for an entire family of inputs that carry no number at all. Every case below was
 * measured returning `lat = 0` before the preprocess, and all four were POSTed to a
 * live API and answered `201`, planting rows at (0, 0) that a later search returned
 * as real notices.
 *
 * These cases live in the contracts package because that is where the bug was. The
 * hazard had already been patched twice downstream — once in the API's query schema
 * and once in the web wizard's location picker — while the schema itself kept
 * coercing, which left a non-browser client posting JSON with no defence at all.
 */
describe("CreateNoticeSchema coordinate coercion", () => {
  const blankish: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a tab", "\t"],
    // Number(false) === 0 and Number(true) === 1, so a boolean used to be a
    // coordinate.
    ["false", false],
    ["true", true],
    // Number([]) === 0. This is the one that is easiest to miss: an empty array
    // stringifies to "" and then coerces to 0.
    ["an empty array", []],
    ["an empty object", {}],
    ["a one-element array", [36.75]],
  ];

  it.each(blankish)("rejects a lat that is not a number (%s)", (_label, lat) => {
    const result = CreateNoticeSchema.safeParse({ ...valid, lat });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "lat")).toBe(true);
  });

  it.each(blankish)("rejects an lng that is not a number (%s)", (_label, lng) => {
    const result = CreateNoticeSchema.safeParse({ ...valid, lng });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "lng")).toBe(true);
  });

  it("still rejects a non-numeric string, as it always did", () => {
    expect(CreateNoticeSchema.safeParse({ ...valid, lat: "abc" }).success).toBe(false);
  });

  it.each([
    // Number("0x10") === 16, so a hex literal used to become latitude 16 —
    // a coordinate the caller never wrote anywhere.
    ["a hex literal", "0x10"],
    ["the string Infinity", "Infinity"],
    ["the string NaN", "NaN"],
    ["a comma decimal", "1,5"],
  ])("rejects a string Number() would have mangled (%s)", (_label, lat) => {
    expect(CreateNoticeSchema.safeParse({ ...valid, lat }).success).toBe(false);
  });

  it.each([
    ["a numeric zero", 0],
    ["a negative zero", -0],
    ["the string zero", "0"],
  ])("accepts %s — the equator and prime meridian are real places", (_label, value) => {
    // The counterfactual for every rejection above. A guard written as
    // `if (!value) reject` passes all the blank cases and then quietly outlaws
    // 0°N 0°E, which someone may legitimately publish at. Fixing the coercion must
    // not become "reject zero".
    const result = CreateNoticeSchema.safeParse({ ...valid, lat: value, lng: value });
    expect(result.success).toBe(true);
    // `===` rather than `toBe`, which uses Object.is semantics and would treat the
    // legitimately-returned `-0` as unequal to `0`. What matters is numeric zero.
    expect(result.data?.lat === 0).toBe(true);
    expect(result.data?.lng === 0).toBe(true);
  });

  it("still coerces a genuine numeric string, so query strings and forms keep working", () => {
    const parsed = CreateNoticeSchema.parse({ ...valid, lat: "36.75", lng: "3.06" });
    expect(parsed.lat).toBe(36.75);
    expect(parsed.lng).toBe(3.06);
  });

  it("tolerates whitespace around a real number", () => {
    expect(CreateNoticeSchema.parse({ ...valid, lat: " 36.75 " }).lat).toBe(36.75);
  });

  it("accepts exponent and leading-dot forms, which geocoders emit", () => {
    expect(CreateNoticeSchema.parse({ ...valid, lat: "1e-7" }).lat).toBe(1e-7);
    expect(CreateNoticeSchema.parse({ ...valid, lat: ".5" }).lat).toBe(0.5);
  });

  it("still enforces the latitude and longitude bounds", () => {
    expect(CreateNoticeSchema.safeParse({ ...valid, lat: 91 }).success).toBe(false);
    expect(CreateNoticeSchema.safeParse({ ...valid, lng: 181 }).success).toBe(false);
    expect(CreateNoticeSchema.safeParse({ ...valid, lat: -90, lng: -180 }).success).toBe(true);
  });
});

/**
 * The NUL-byte guard on the create body's text fields.
 *
 * Postgres rejects `U+0000` inside `text` at the protocol level, so binding the
 * parameter is no help: the driver raises `invalid byte sequence for encoding
 * "UTF8": 0x00` (SQLSTATE 22021) and the request became a **500** rather than the
 * 400 a malformed body deserves. It also amplified — the handler logged the failing
 * SQL and every bound parameter, so a 4 KB body wrote roughly 11.6 KB of log per
 * unauthenticated request, which is a cheap way to fill a disk.
 *
 * Task 8 closed the query-string half of this (`?categories=a%00b` answers a clean
 * 400). These cases close the body half, one per field that reaches SQL.
 */
describe("CreateNoticeSchema NUL-byte guard", () => {
  // Every free-form string in the body that is stored in a text/varchar column.
  // `lat`/`lng` are numbers by the time anything is bound, and `startsAt` and
  // `attendance` are validated as a datetime and an enum, so a NUL cannot survive
  // either of them.
  const guardedFields = [
    "categorySlug",
    "title",
    "description",
    "venueName",
    "address",
    "organizerName",
    "organizerContact",
  ] as const;

  it.each(guardedFields)("rejects a NUL byte in %s", (field) => {
    const result = CreateNoticeSchema.safeParse({
      ...valid,
      // Long enough to clear the title's own 3-character minimum, so the rejection
      // is attributable to the NUL rather than to a length rule.
      [field]: "a\u0000bcdef",
      // Only relevant for organizerContact, where a value without consent would be
      // rejected by the consent refinement instead and prove nothing.
      organizerConsent: true,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === field)).toBe(true);
    expect(result.error?.issues.some((issue) => /NUL byte/.test(issue.message))).toBe(true);
  });

  it("rejects a NUL byte anywhere in a longer string, not only at the start", () => {
    expect(
      CreateNoticeSchema.safeParse({ ...valid, description: `${"x".repeat(200)}\u0000tail` }).success,
    ).toBe(false);
  });

  it("leaves every other string untouched: trimming, defaults and length caps still apply", () => {
    // The guard is chained onto each field's own contract schema rather than
    // replacing it, so nothing about the accepted input changed.
    const parsed = CreateNoticeSchema.parse({ ...valid, title: "  Spaced title  ", description: undefined });
    expect(parsed.title).toBe("Spaced title");
    expect(parsed.description).toBe("");
    expect(CreateNoticeSchema.safeParse({ ...valid, title: "x".repeat(161) }).success).toBe(false);
  });

  it("still enforces the organizer-consent rule after the guard was added", () => {
    // `safeExtend` was needed because zod 4 refuses to overwrite a key on an object
    // schema that already carries a refinement. Pinned here so a future refactor
    // cannot reorder the two and drop the consent check silently.
    expect(
      CreateNoticeSchema.safeParse({ ...valid, organizerContact: "+213 555 0000", organizerConsent: false })
        .success,
    ).toBe(false);
  });
});
