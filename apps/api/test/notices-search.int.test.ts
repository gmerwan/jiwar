import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { SearchNoticesSchema } from "@jiwar/contracts";
import { NoticesRepository } from "../src/notices/notices.repository.js";
import { startTestDb, type TestDb } from "./db-harness.js";
import { ALGIERS, makeNotice, makeParticipant, offsetPoint } from "./fixtures.js";

const GRACE = { pastGraceHours: 24 };
const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

describe("NoticesRepository.search", () => {
  let testDb: TestDb;
  let repo: NoticesRepository;

  beforeAll(async () => {
    testDb = await startTestDb();
    await testDb.seedCategories();
    repo = new NoticesRepository(testDb.db);
  }, 180_000);

  afterEach(async () => {
    await testDb.truncate();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  const search = (overrides: Record<string, unknown> = {}) =>
    repo.search(
      SearchNoticesSchema.parse({ lat: ALGIERS.lat, lng: ALGIERS.lng, ...overrides }),
      GRACE,
    );

  it("includes a notice just inside the radius", async () => {
    const inside = offsetPoint(ALGIERS, 19_000);
    await makeNotice(testDb.db, { ...inside, title: "Inside" });

    const result = await search({ radiusKm: 20 });
    expect(result.items.map((i) => i.title)).toEqual(["Inside"]);
  });

  it("excludes a notice just outside the radius", async () => {
    const outside = offsetPoint(ALGIERS, 21_000);
    await makeNotice(testDb.db, { ...outside, title: "Outside" });

    const result = await search({ radiusKm: 20 });
    expect(result.items).toHaveLength(0);
  });

  it("reports distance in metres", async () => {
    const point = offsetPoint(ALGIERS, 5_000);
    await makeNotice(testDb.db, point);

    const result = await search({ radiusKm: 20 });
    expect(result.items[0]!.distanceMetres).toBeGreaterThan(4_800);
    expect(result.items[0]!.distanceMetres).toBeLessThan(5_200);
  });

  it("works across the antimeridian", async () => {
    // Two points 40 km apart straddling longitude 180.
    const origin = { lat: 0, lng: 179.9 };
    await makeNotice(testDb.db, { lat: 0, lng: -179.9, title: "Across" });

    const result = await repo.search(
      SearchNoticesSchema.parse({ lat: origin.lat, lng: origin.lng, radiusKm: 30 }),
      GRACE,
    );
    expect(result.items.map((i) => i.title)).toEqual(["Across"]);
  });

  it("treats a notice within the grace window as upcoming, and past it as past", async () => {
    await makeNotice(testDb.db, { startsAt: hoursFromNow(-23), title: "Recent" });
    await makeNotice(testDb.db, { startsAt: hoursFromNow(-25), title: "Old" });

    const upcoming = await search({ when: "upcoming" });
    expect(upcoming.items.map((i) => i.title)).toEqual(["Recent"]);

    const past = await search({ when: "past" });
    expect(past.items.map((i) => i.title)).toEqual(["Old"]);
  });

  it("returns past notices as a fallback when nothing is upcoming", async () => {
    await makeNotice(testDb.db, { startsAt: hoursFromNow(-48), title: "Last week" });

    const result = await search({ when: "upcoming" });
    expect(result.fallback).toBe(true);
    expect(result.items.map((i) => i.title)).toEqual(["Last week"]);
  });

  it("does not fall back when the search is explicitly for past notices", async () => {
    const result = await search({ when: "past" });
    expect(result.fallback).toBe(false);
    expect(result.items).toHaveLength(0);
  });

  it("does not fall back when upcoming results exist", async () => {
    await makeNotice(testDb.db, { startsAt: hoursFromNow(2), title: "Soon" });
    await makeNotice(testDb.db, { startsAt: hoursFromNow(-48), title: "Old" });

    const result = await search({ when: "upcoming" });
    expect(result.fallback).toBe(false);
    expect(result.items.map((i) => i.title)).toEqual(["Soon"]);
  });

  it("excludes cancelled and removed notices", async () => {
    await makeNotice(testDb.db, { status: "cancelled", title: "Cancelled" });
    await makeNotice(testDb.db, { status: "removed", title: "Removed" });
    await makeNotice(testDb.db, { status: "published", title: "Published" });

    const result = await search();
    expect(result.items.map((i) => i.title)).toEqual(["Published"]);
  });

  it("filters by category", async () => {
    await makeNotice(testDb.db, { categorySlug: "funeral", title: "A funeral" });
    await makeNotice(testDb.db, { categorySlug: "wedding", title: "A wedding" });

    const result = await search({ categories: ["wedding"] });
    expect(result.items.map((i) => i.title)).toEqual(["A wedding"]);
  });

  it("sorts by soonest, then by nearest when asked", async () => {
    await makeNotice(testDb.db, {
      ...offsetPoint(ALGIERS, 15_000),
      startsAt: hoursFromNow(1),
      title: "Far but soon",
    });
    await makeNotice(testDb.db, {
      ...offsetPoint(ALGIERS, 1_000),
      startsAt: hoursFromNow(10),
      title: "Near but later",
    });

    const bySoonest = await search({ sort: "soonest" });
    expect(bySoonest.items.map((i) => i.title)).toEqual(["Far but soon", "Near but later"]);

    const byNearest = await search({ sort: "nearest" });
    expect(byNearest.items.map((i) => i.title)).toEqual(["Near but later", "Far but soon"]);
  });

  it("paginates with a stable cursor and no duplicates", async () => {
    for (let i = 0; i < 5; i++) {
      await makeNotice(testDb.db, { startsAt: hoursFromNow(i + 1), title: `Notice ${i}` });
    }

    const first = await search({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await search({ limit: 2, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(2);

    const seen = [...first.items, ...second.items].map((i) => i.title);
    expect(new Set(seen).size).toBe(4);
  });

  it("returns a null cursor on the last page", async () => {
    await makeNotice(testDb.db, { title: "Only one" });
    const result = await search({ limit: 20 });
    expect(result.nextCursor).toBeNull();
  });

  it("includes the category on each item", async () => {
    await makeNotice(testDb.db, { categorySlug: "aqiqah" });
    const result = await search();
    expect(result.items[0]!.category.slug).toBe("aqiqah");
    expect(result.items[0]!.category.name).toBe("Aqiqah");
  });
});

describe("NoticesRepository.cancel", () => {
  let testDb: TestDb;
  let repo: NoticesRepository;

  beforeAll(async () => {
    testDb = await startTestDb();
    await testDb.seedCategories();
    repo = new NoticesRepository(testDb.db);
  }, 180_000);

  afterEach(async () => {
    await testDb.truncate();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it("lets the author cancel their own notice", async () => {
    const author = await makeParticipant(testDb.db);
    const notice = await makeNotice(testDb.db, { authorParticipantId: author });

    const cancelled = await repo.cancel(notice.publicId, author);
    expect(cancelled).toBe(true);

    const found = await repo.findByPublicId(notice.publicId);
    expect(found?.status).toBe("cancelled");
  });

  it("refuses to let one participant cancel another participant's notice", async () => {
    const author = await makeParticipant(testDb.db);
    const stranger = await makeParticipant(testDb.db);
    const notice = await makeNotice(testDb.db, { authorParticipantId: author });

    const cancelled = await repo.cancel(notice.publicId, stranger);
    expect(cancelled).toBe(false);

    const found = await repo.findByPublicId(notice.publicId);
    expect(found?.status).toBe("published");
  });
});

/**
 * The 16 cases above are the brief's. These are additional regressions for traps
 * that the brief names but its cases do not actually exercise — each one here
 * failed, or could have silently passed for the wrong reason, during this task.
 */
describe("NoticesRepository.search — trap regressions", () => {
  let testDb: TestDb;
  let repo: NoticesRepository;

  beforeAll(async () => {
    testDb = await startTestDb();
    await testDb.seedCategories();
    repo = new NoticesRepository(testDb.db);
  }, 180_000);

  afterEach(async () => {
    await testDb.truncate();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  const search = (overrides: Record<string, unknown> = {}) =>
    repo.search(
      SearchNoticesSchema.parse({ lat: ALGIERS.lat, lng: ALGIERS.lng, ...overrides }),
      GRACE,
    );

  // The brief's category case passes a single slug, so it never distinguishes a
  // correctly bound array from Drizzle's list expansion. With the brief's literal
  // `ANY(${params.categories})` this and the single-slug case both failed with
  // `22P02 malformed array literal: "wedding"`.
  it("filters on several categories at once", async () => {
    await makeNotice(testDb.db, { categorySlug: "wedding", title: "A wedding" });
    await makeNotice(testDb.db, { categorySlug: "aqiqah", title: "An aqiqah" });
    await makeNotice(testDb.db, { categorySlug: "funeral", title: "A funeral" });

    const result = await search({ categories: ["wedding", "aqiqah"] });
    expect(result.items.map((i) => i.title).sort()).toEqual(["A wedding", "An aqiqah"]);
  });

  it("accepts a bare category string, as a query string yields for one value", async () => {
    await makeNotice(testDb.db, { categorySlug: "wedding", title: "A wedding" });
    await makeNotice(testDb.db, { categorySlug: "funeral", title: "A funeral" });

    // SearchNoticesSchema coerces a lone string into a one-element array, so the
    // repository must still bind it as an array.
    const result = await search({ categories: "wedding" });
    expect(result.items.map((i) => i.title)).toEqual(["A wedding"]);
  });

  it("does not fall back when a category filter matches nothing", async () => {
    await makeNotice(testDb.db, { categorySlug: "funeral", title: "A funeral" });

    const result = await search({ categories: ["wedding"] });
    expect(result.items).toHaveLength(0);
    expect(result.fallback).toBe(false);
  });

  // The cursor's whole reason for carrying `p` is ties. The brief's pagination case
  // gives every notice a distinct `starts_at`, so a cursor with no tiebreaker would
  // still pass it.
  it("pages through notices that all share the same starts_at without loss", async () => {
    const sameInstant = hoursFromNow(5);
    for (let i = 0; i < 5; i++) {
      await makeNotice(testDb.db, { startsAt: sameInstant, title: `Tie ${i}` });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await search(cursor ? { limit: 2, cursor } : { limit: 2 });
      seen.push(...page.items.map((item) => item.publicId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("pages through notices at an identical distance without loss", async () => {
    const samePlace = offsetPoint(ALGIERS, 3_000);
    for (let i = 0; i < 5; i++) {
      await makeNotice(testDb.db, { ...samePlace, title: `Same ${i}` });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await search(
        cursor ? { limit: 2, cursor, sort: "nearest" } : { limit: 2, sort: "nearest" },
      );
      seen.push(...page.items.map((item) => item.publicId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("pages past notices newest-first without loss", async () => {
    for (let index = 1; index <= 5; index++) {
      await makeNotice(testDb.db, { startsAt: hoursFromNow(-24 - index), title: `Past ${index}` });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await search(
        cursor ? { limit: 2, cursor, when: "past" } : { limit: 2, when: "past" },
      );
      seen.push(...page.items.map((item) => item.title));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    // Newest first: `Past 1` started one hour past the cutoff, `Past 5` five.
    expect(seen).toEqual(["Past 1", "Past 2", "Past 3", "Past 4", "Past 5"]);
  });

  // A cursor is a client-supplied opaque string, so a malformed one must not 500.
  it("ignores a malformed cursor rather than throwing", async () => {
    await makeNotice(testDb.db, { title: "Only one" });

    for (const bad of ["not-base64!!", Buffer.from('{"k":"x"}').toString("base64url"), ""]) {
      const result = await search({ limit: 5, cursor: bad });
      expect(result.items.map((i) => i.title)).toEqual(["Only one"]);
    }
  });

  // The brief's antimeridian case asserts only that the near point is found, which a
  // filter matching *everything* would also satisfy. This pins the exclusion too.
  it("measures across the antimeridian without wrapping the radius around the globe", async () => {
    await makeNotice(testDb.db, { lat: 0, lng: -179.9, title: "Across" });
    await makeNotice(testDb.db, { lat: 0, lng: -179.0, title: "Too far" });

    const result = await repo.search(
      SearchNoticesSchema.parse({ lat: 0, lng: 179.9, radiusKm: 30 }),
      GRACE,
    );
    expect(result.items.map((i) => i.title)).toEqual(["Across"]);
    // 0.2 degrees of longitude at the equator, the short way round: ~22.3 km.
    // A geometry cast would report 359.8 (degrees), and a naive bounding box would
    // have excluded this row entirely.
    expect(result.items[0]!.distanceMetres).toBeGreaterThan(22_000);
    expect(result.items[0]!.distanceMetres).toBeLessThan(22_500);
  });

  // The grace window at minute resolution rather than the brief's whole hours.
  it("puts a notice on the correct side of the grace cutoff to the minute", async () => {
    await makeNotice(testDb.db, { startsAt: hoursFromNow(-23.9), title: "Just inside" });

    const upcoming = await search({ when: "upcoming" });
    expect(upcoming.items.map((i) => i.title)).toEqual(["Just inside"]);
    expect(upcoming.fallback).toBe(false);
    expect(upcoming.items[0]!.isPast).toBe(false);

    await testDb.truncate();
    await makeNotice(testDb.db, { startsAt: hoursFromNow(-24.02), title: "Just outside" });

    const afterCutoff = await search({ when: "upcoming" });
    expect(afterCutoff.items.map((i) => i.title)).toEqual(["Just outside"]);
    // Only reachable through the past-notice fallback, and flagged as past.
    expect(afterCutoff.fallback).toBe(true);
    expect(afterCutoff.items[0]!.isPast).toBe(true);
  });

  it("keeps a fallback page's cursor usable for the rest of the past results", async () => {
    for (let index = 1; index <= 4; index++) {
      await makeNotice(testDb.db, { startsAt: hoursFromNow(-30 - index), title: `Old ${index}` });
    }

    const first = await search({ when: "upcoming", limit: 2 });
    expect(first.fallback).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await search({ when: "upcoming", limit: 2, cursor: first.nextCursor! });
    const seen = [...first.items, ...second.items].map((i) => i.title);
    expect(new Set(seen).size).toBe(4);
  });

  /**
   * The gist index is what makes this query scale, and nothing above would fail if
   * the planner stopped using it — a sequential scan returns identical rows. A few
   * fixture rows always seq-scan regardless, so this loads enough rows that the
   * planner has a real choice, then asserts on the plan it picks.
   */
  it("filters the radius through the gist index rather than scanning every notice", async () => {
    const author = await makeParticipant(testDb.db);
    const categoryId = (
      await testDb.db.execute<{ id: number }>(
        sql`SELECT id FROM categories WHERE slug = 'funeral'`,
      )
    )[0]!.id;

    await testDb.db.execute(sql`
      INSERT INTO notices (public_id, category_id, title, description, venue_name, address,
                           location, starts_at, attendance, status, author_participant_id)
      SELECT substr(md5(g::text), 1, 12), ${categoryId}, 'Bulk ' || g, '', 'v', 'a',
             ST_SetSRID(ST_MakePoint(-10 + (g % 3600) * 0.01, -30 + (g % 1200) * 0.05), 4326)::geography,
             now() + make_interval(hours => (g % 200)), 'public', 'published', ${author}
      FROM generate_series(1, 20000) g
    `);
    await testDb.db.execute(sql`ANALYZE notices`);

    const origin = sql`ST_SetSRID(ST_MakePoint(${ALGIERS.lng}, ${ALGIERS.lat}), 4326)::geography`;
    const plan = await testDb.db.execute<{ "QUERY PLAN": string }>(sql`
      EXPLAIN SELECT n.public_id, ST_Distance(n.location, ${origin}) AS d
      FROM notices n JOIN categories c ON c.id = n.category_id
      WHERE n.status = 'published' AND ST_DWithin(n.location, ${origin}, 20000)
    `);
    const text = plan.map((row) => row["QUERY PLAN"]).join("\n");

    expect(text).toContain("Index Scan using notices_location_gist");
    expect(text).not.toContain("Seq Scan on notices");
  });
});
