import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestDb, type TestDb } from "./db-harness.js";

describe("test database harness", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
  }, 120_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  it("provides a real PostGIS installation", async () => {
    const result = await testDb.db.execute<{ v: string }>(sql`SELECT postgis_version() AS v`);
    expect(result[0]?.v).toContain("3.");
  });

  it("has run the migrations, so the notices table exists with a geography column", async () => {
    const result = await testDb.db.execute<{ udt_name: string }>(sql`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name = 'notices' AND column_name = 'location'
    `);
    expect(result[0]?.udt_name).toBe("geography");
  });

  it("measures distance in metres, not degrees", async () => {
    const result = await testDb.db.execute<{ m: number }>(sql`
      SELECT round(ST_Distance(
        'POINT(3.06 36.75)'::geography,
        'POINT(3.10 36.78)'::geography
      )) AS m
    `);
    expect(Number(result[0]?.m)).toBeGreaterThan(4000);
    expect(Number(result[0]?.m)).toBeLessThan(6000);
  });

  it("seeds the six categories", async () => {
    await testDb.seedCategories();
    const result = await testDb.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM categories`);
    expect(Number(result[0]?.n)).toBe(6);
  });
});
