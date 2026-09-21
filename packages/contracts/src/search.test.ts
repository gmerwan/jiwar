import { describe, expect, it } from "vitest";
import { SearchNoticesSchema } from "./search.js";

describe("SearchNoticesSchema", () => {
  it("coerces query-string values into numbers", () => {
    const result = SearchNoticesSchema.parse({ lat: "36.75", lng: "3.06", radiusKm: "20" });
    expect(result.lat).toBe(36.75);
    expect(result.lng).toBe(3.06);
    expect(result.radiusKm).toBe(20);
  });

  it("defaults radius to 20 km, sort to soonest, and when to upcoming", () => {
    const result = SearchNoticesSchema.parse({ lat: "36.75", lng: "3.06" });
    expect(result.radiusKm).toBe(20);
    expect(result.sort).toBe("soonest");
    expect(result.when).toBe("upcoming");
  });

  it("rejects out-of-range coordinates", () => {
    expect(() => SearchNoticesSchema.parse({ lat: "91", lng: "0" })).toThrow();
    expect(() => SearchNoticesSchema.parse({ lat: "0", lng: "181" })).toThrow();
  });

  it("rejects a non-positive or oversized radius", () => {
    expect(() => SearchNoticesSchema.parse({ lat: "36", lng: "3", radiusKm: "0" })).toThrow();
    expect(() => SearchNoticesSchema.parse({ lat: "36", lng: "3", radiusKm: "-5" })).toThrow();
    expect(() => SearchNoticesSchema.parse({ lat: "36", lng: "3", radiusKm: "100000" })).toThrow();
  });

  it("accepts a single category slug or a list", () => {
    expect(SearchNoticesSchema.parse({ lat: "36", lng: "3", categories: "funeral" }).categories)
      .toEqual(["funeral"]);
    expect(SearchNoticesSchema.parse({ lat: "36", lng: "3", categories: ["funeral", "wedding"] }).categories)
      .toEqual(["funeral", "wedding"]);
  });
});

/**
 * The same Null Island guard, seen through the search schema.
 *
 * `SearchNoticesSchema` shares `LatitudeSchema`/`LongitudeSchema` with the create
 * body, so these cases are not a duplicate of `notice.test.ts` — they are what
 * proves the fix reached the *shared* schemas rather than one consumer. Before the
 * preprocess, `?lat=&lng=` (exactly what a browser submits for an empty field)
 * searched from (0, 0) in the Gulf of Guinea and reported "no notices near you": a
 * silent wrong answer rather than an error.
 *
 * The API additionally wraps these fields in its own `SearchNoticesQuerySchema`
 * guard, which predates this fix and is kept — the two now agree rather than one
 * masking the other.
 */
describe("SearchNoticesSchema coordinate coercion", () => {
  const blankish: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a tab", "\t"],
    ["false", false],
    ["true", true],
    ["an empty array", []],
    ["an empty object", {}],
    ["a one-element array", [36.75]],
  ];

  it.each(blankish)("rejects a lat that is not a number (%s)", (_label, lat) => {
    const result = SearchNoticesSchema.safeParse({ lat, lng: "3.06" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "lat")).toBe(true);
  });

  it.each(blankish)("rejects an lng that is not a number (%s)", (_label, lng) => {
    const result = SearchNoticesSchema.safeParse({ lat: "36.75", lng });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "lng")).toBe(true);
  });

  it.each([
    // `?lat=0x10` used to search from latitude 16 — a place the caller never named.
    ["a hex literal", "0x10"],
    ["the string Infinity", "Infinity"],
    ["the string NaN", "NaN"],
    ["a comma decimal", "1,5"],
    ["a non-numeric string", "abc"],
  ])("rejects a string Number() would have mangled (%s)", (_label, lat) => {
    expect(SearchNoticesSchema.safeParse({ lat, lng: "3" }).success).toBe(false);
  });

  it.each([
    ["a numeric zero", 0],
    ["a negative zero", -0],
    ["the string zero", "0"],
  ])("accepts %s — someone may legitimately search at 0, 0", (_label, value) => {
    const result = SearchNoticesSchema.safeParse({ lat: value, lng: value });
    expect(result.success).toBe(true);
    // `===` rather than `toBe`: Object.is semantics would treat the legitimately
    // returned `-0` as unequal to `0`, and numeric zero is what matters here.
    expect(result.data?.lat === 0).toBe(true);
    expect(result.data?.lng === 0).toBe(true);
  });

  it("leaves every other field's default untouched", () => {
    // Drift guard: the preprocess must not have disturbed the rest of the schema,
    // or a bare search would mean something different to the client and the server.
    expect(SearchNoticesSchema.parse({ lat: "36.75", lng: "3.06" })).toEqual({
      lat: 36.75,
      lng: 3.06,
      radiusKm: 20,
      when: "upcoming",
      sort: "soonest",
      limit: 20,
    });
  });
});
