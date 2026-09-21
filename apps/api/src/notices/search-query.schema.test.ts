import { SearchNoticesSchema } from "@jiwar/contracts";
import { describe, expect, it } from "vitest";
import { SearchNoticesQuerySchema } from "./search-query.schema.js";

/**
 * Unit coverage for the blank-coordinate guard.
 *
 * These cases live here rather than only in the HTTP test because a query string
 * can only ever deliver a *string*: `?lat=0` arrives as `"0"`, never as the number
 * `0`. So the numeric-zero case — the one a naive `if (!value)` guard would
 * wrongly reject — is unreachable through supertest and can only be pinned by
 * parsing the schema directly. The schema is exported and could be reused for a
 * non-query caller, so its behaviour on real JS values is worth fixing in place.
 */
describe("SearchNoticesQuerySchema blank-coordinate guard", () => {
  const origin = { lat: "36.7538", lng: "3.0588" };

  it("no longer needs to document a contract bug: the contract rejects blanks itself", () => {
    // This assertion is inverted from what it originally said, and the inversion is
    // the point. It used to record the bug — `SearchNoticesSchema.parse({ lat: "" })`
    // returned `{ lat: 0 }` — with a note that a future fix in the contracts package
    // should make it "fail loudly rather than leaving a now-redundant guard in place
    // silently". The final-review wave applied that fix (a `z.preprocess` on
    // `LatitudeSchema`/`LongitudeSchema` mapping non-numbers to `undefined`), this
    // test duly failed, and it is rewritten here to pin the new behaviour.
    //
    // The local guard above is therefore no longer the *only* line of defence for a
    // blank coordinate. It is kept deliberately rather than deleted: it is what makes
    // the OpenAPI document and the error message describe `lat` as a required number
    // at the HTTP boundary, and removing it is a separate decision from fixing the
    // contract. What matters for correctness is that the two now agree — both reject
    // — rather than one masking the other.
    expect(SearchNoticesSchema.safeParse({ lat: "", lng: "3" }).success).toBe(false);
    expect(SearchNoticesSchema.safeParse({ lat: null, lng: 3 }).success).toBe(false);
    // And the contract still accepts a real zero, so the fix did not trade one
    // wrong answer for another by outlawing the equator.
    expect(SearchNoticesSchema.parse({ lat: 0, lng: 0 }).lat).toBe(0);
  });

  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["a tab", "\t"],
    ["null", null],
    ["undefined", undefined],
  ])("rejects a blank lat (%s)", (_label, lat) => {
    const result = SearchNoticesQuerySchema.safeParse({ ...origin, lat });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === "lat")).toBe(true);
  });

  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["null", null],
    ["undefined", undefined],
  ])("rejects a blank lng (%s)", (_label, lng) => {
    const result = SearchNoticesQuerySchema.safeParse({ ...origin, lng });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === "lng")).toBe(true);
  });

  it.each([
    ["a numeric zero", 0],
    ["the string zero", "0"],
    ["a negative zero", -0],
  ])("accepts %s as a real coordinate, not a blank", (_label, value) => {
    // The counterfactual for every case above. A guard written as `if (!value)`
    // passes all the blank tests and every HTTP test — a query string cannot
    // deliver the number 0 — yet silently rejects the equator for any caller that
    // parses the schema with real numbers. This is the only place that catches it.
    const result = SearchNoticesQuerySchema.safeParse({ lat: value, lng: value });
    expect(result.success).toBe(true);
    // Compared with `===` rather than `toBe`/`toEqual`: both use Object.is
    // semantics for zero, under which `-0` is not `+0`, and `-0` is exactly what
    // the schema legitimately returns for a `-0` input. What matters here is that
    // the value is numerically zero and was not rejected as blank.
    expect(result.data?.lat === 0).toBe(true);
    expect(result.data?.lng === 0).toBe(true);
  });

  it("still rejects a non-numeric coordinate, as the contract did", () => {
    expect(SearchNoticesQuerySchema.safeParse({ ...origin, lat: "abc" }).success).toBe(false);
  });

  it("still enforces the contract's latitude and longitude bounds", () => {
    expect(SearchNoticesQuerySchema.safeParse({ lat: 91, lng: 3 }).success).toBe(false);
    expect(SearchNoticesQuerySchema.safeParse({ lat: 36, lng: 181 }).success).toBe(false);
    expect(SearchNoticesQuerySchema.safeParse({ lat: -90, lng: -180 }).success).toBe(true);
  });

  it("produces exactly the contract's defaults for every other field", () => {
    // Drift guard: if a later edit here changes a default, the guarded query
    // schema and the shared contract would disagree about what a bare search
    // means, and Task 10's client would send something the server reads
    // differently.
    const guarded = SearchNoticesQuerySchema.parse(origin);
    const contract = SearchNoticesSchema.parse(origin);
    expect(guarded).toEqual(contract);
    expect(guarded).toEqual({
      lat: 36.7538,
      lng: 3.0588,
      radiusKm: 20,
      when: "upcoming",
      sort: "soonest",
      limit: 20,
    });
  });

  it("passes cursor, categories and limit through unchanged", () => {
    const parsed = SearchNoticesQuerySchema.parse({
      ...origin,
      categories: "funeral",
      cursor: "abc",
      limit: "5",
      sort: "nearest",
      when: "past",
    });
    expect(parsed).toEqual({
      lat: 36.7538,
      lng: 3.0588,
      radiusKm: 20,
      categories: ["funeral"],
      cursor: "abc",
      limit: 5,
      sort: "nearest",
      when: "past",
    });
  });
});
