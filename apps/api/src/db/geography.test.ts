import { describe, expect, it } from "vitest";
import { parseWkbPoint } from "./geography.js";

// Every fixture below is hex emitted by the running PostGIS 3.6 itself, not hand-written,
// so these assertions describe what the database actually sends over the wire.
//   SELECT 'SRID=4326;POINT(3.06 36.75)'::geography;
//   SELECT encode(ST_AsEWKB(<geom>, 'XDR'), 'hex');
const LE_POINT_4326 = "0101000020E61000007B14AE47E17A08400000000000604240";
const BE_POINT_4326 = "0020000001000010e640087ae147ae147b4042600000000000";
const LE_POINT_NO_SRID = "01010000007b14ae47e17a08400000000000604240";
const BE_POINT_NO_SRID = "000000000140087ae147ae147b4042600000000000";
const LE_POINT_3857 = "0101000020110F00007B14AE47E17A08400000000000604240";
const BE_POINT_3857 = "002000000100000f1140087ae147ae147b4042600000000000";
const LE_LINESTRING_4326 =
  "0102000020E6100000020000007B14AE47E17A08400000000000604240E17A14AE47E10840C3F5285C8F624240";
const BE_LINESTRING_4326 =
  "0020000002000010e60000000240087ae147ae147b40426000000000004008e147ae147ae14042628f5c28f5c3";
const LE_POLYGON_4326 =
  "0103000020E6100000010000000400000000000000000000000000000000000000000000000000F03F0000000000000000000000000000F03F000000000000F03F00000000000000000000000000000000";

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

  describe("rejects malformed input rather than returning plausible coordinates", () => {
    it("throws on a geometry type that is not Point", () => {
      // LineString is type 2, Polygon type 3. Before validation these parsed the
      // point-count word as a coordinate and returned numbers like 1.99e+37.
      expect(() => parseWkbPoint(LE_LINESTRING_4326)).toThrow(
        /Expected geometry type Point \(1\), got 2/,
      );
      expect(() => parseWkbPoint(BE_LINESTRING_4326)).toThrow(
        /Expected geometry type Point \(1\), got 2/,
      );
      expect(() => parseWkbPoint(LE_POLYGON_4326)).toThrow(
        /Expected geometry type Point \(1\), got 3/,
      );
    });

    it("throws on a point whose SRID is not 4326", () => {
      // Same coordinate bytes as the good fixture, so this is silently accepted
      // as degrees without the SRID check -- the most dangerous of these cases.
      expect(() => parseWkbPoint(LE_POINT_3857)).toThrow(/Expected SRID 4326, got 3857/);
      expect(() => parseWkbPoint(BE_POINT_3857)).toThrow(/Expected SRID 4326, got 3857/);
    });

    it("throws on a byte-order byte that is neither 0 nor 1", () => {
      // Previously returned {lng: -4.2e+183, lat: -3.7e+161}: the bogus byte fell
      // through to the big-endian branch and every offset was misread.
      const hex = `07${LE_POINT_4326.slice(2)}`;
      expect(() => parseWkbPoint(hex)).toThrow(
        /Invalid WKB byte order: expected 0 \(big-endian\) or 1 \(little-endian\), got 7/,
      );
    });

    it("throws on odd-length hex instead of dropping the trailing nibble", () => {
      expect(() => parseWkbPoint(`${LE_POINT_4326}A`)).toThrow(/odd length \(51\)/);
    });
  });

  describe("keeps every layout the driver can legitimately send", () => {
    it("parses big-endian EWKB with SRID 4326", () => {
      const point = parseWkbPoint(BE_POINT_4326);
      expect(point.lng).toBeCloseTo(3.06, 5);
      expect(point.lat).toBeCloseTo(36.75, 5);
    });

    it("parses a bare point with no SRID in both byte orders", () => {
      // The 42-char no-SRID layout: coordinates start at offset 5, not 9.
      const le = parseWkbPoint(LE_POINT_NO_SRID);
      expect(le.lng).toBeCloseTo(3.06, 5);
      expect(le.lat).toBeCloseTo(36.75, 5);

      const be = parseWkbPoint(BE_POINT_NO_SRID);
      expect(be.lng).toBeCloseTo(3.06, 5);
      expect(be.lat).toBeCloseTo(36.75, 5);
    });
  });
});
