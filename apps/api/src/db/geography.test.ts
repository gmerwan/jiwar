import { describe, expect, it } from "vitest";
import { parseWkbPoint } from "./geography.js";

describe("parseWkbPoint", () => {
  it("parses a little-endian EWKB point with SRID 4326", () => {
    // POINT(3.06 36.75) as geography(Point,4326), little-endian EWKB.
    // Fixture is the canonical hex PostGIS 3.6 itself emits for this value:
    //   SELECT 'SRID=4326;POINT(3.06 36.75)'::geography;
    const hex = "0101000020E61000007B14AE47E17A08400000000000604240";
    const point = parseWkbPoint(hex);
    expect(point.lng).toBeCloseTo(3.06, 5);
    expect(point.lat).toBeCloseTo(36.75, 5);
  });

  it("throws on input that is not a hex point", () => {
    expect(() => parseWkbPoint("not-hex")).toThrow();
  });
});
