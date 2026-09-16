import { customType } from "drizzle-orm/pg-core";

export interface LngLat {
  lng: number;
  lat: number;
}

/** EWKB flag bits PostGIS ORs into the type word, and the mask that strips them. */
const WKB_SRID_FLAG = 0x20000000;
const WKB_TYPE_MASK = 0x0fffffff;

/** Base WKB geometry type for a point (2 is LineString, 3 is Polygon, and so on). */
const WKB_TYPE_POINT = 1;

/** The only SRID this column accepts. Anything else is not degrees of lng/lat. */
const EXPECTED_SRID = 4326;

/**
 * Parses PostGIS EWKB hex for a 2D point.
 * Layout: 1 byte endianness, 4 bytes type (with SRID flag), 4 bytes SRID, 8 bytes X, 8 bytes Y.
 *
 * Every field is validated before the coordinates are trusted. Without the geometry-type
 * and SRID checks, a LineString or an SRID 3857 point parses into plausible-looking
 * numbers instead of throwing, and a wrong coordinate on a map pin is a far worse
 * failure than a raised error.
 */
export function parseWkbPoint(hex: string): LngLat {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 42) {
    throw new Error(`Not a WKB point: ${hex.slice(0, 24)}`);
  }
  if (hex.length % 2 !== 0) {
    // Buffer.from would silently drop the trailing nibble, shifting every offset.
    throw new Error(`WKB hex has an odd length (${hex.length}): ${hex.slice(0, 24)}`);
  }
  const buf = Buffer.from(hex, "hex");
  const byteOrder = buf.readUInt8(0);
  if (byteOrder !== 0 && byteOrder !== 1) {
    throw new Error(
      `Invalid WKB byte order: expected 0 (big-endian) or 1 (little-endian), got ${byteOrder}`,
    );
  }
  const littleEndian = byteOrder === 1;
  const typeWord = littleEndian ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  const geometryType = typeWord & WKB_TYPE_MASK;
  if (geometryType !== WKB_TYPE_POINT) {
    throw new Error(`Expected geometry type Point (${WKB_TYPE_POINT}), got ${geometryType}`);
  }
  const hasSrid = (typeWord & WKB_SRID_FLAG) !== 0;
  if (hasSrid) {
    const srid = littleEndian ? buf.readUInt32LE(5) : buf.readUInt32BE(5);
    if (srid !== EXPECTED_SRID) {
      throw new Error(`Expected SRID ${EXPECTED_SRID}, got ${srid}`);
    }
  }
  const offset = hasSrid ? 9 : 5;
  const lng = littleEndian ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
  const lat = littleEndian ? buf.readDoubleLE(offset + 8) : buf.readDoubleBE(offset + 8);
  return { lng, lat };
}

/**
 * geography(Point,4326) column. geography measures in METRES;
 * geometry on SRID 4326 would measure in degrees, which is wrong for a radius search.
 */
export const geographyPoint = customType<{
  data: LngLat;
  driverData: string;
}>({
  dataType() {
    return "geography(Point,4326)";
  },
  fromDriver(value: string): LngLat {
    return parseWkbPoint(value);
  },
  toDriver(value: LngLat): string {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
});
