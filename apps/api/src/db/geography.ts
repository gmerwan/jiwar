import { customType } from "drizzle-orm/pg-core";

export interface LngLat {
  lng: number;
  lat: number;
}

/**
 * Parses PostGIS EWKB hex for a 2D point.
 * Layout: 1 byte endianness, 4 bytes type (with SRID flag), 4 bytes SRID, 8 bytes X, 8 bytes Y.
 */
export function parseWkbPoint(hex: string): LngLat {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 42) {
    throw new Error(`Not a WKB point: ${hex.slice(0, 24)}`);
  }
  const buf = Buffer.from(hex, "hex");
  const littleEndian = buf.readUInt8(0) === 1;
  const typeWord = littleEndian ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  const hasSrid = (typeWord & 0x20000000) !== 0;
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
