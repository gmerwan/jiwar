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
