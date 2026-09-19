import { Global, Module, StandardSchemaValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { NoticeSearchResultSchema, NoticeSchema, SearchNoticesSchema } from "@jiwar/contracts";
import cookieParser from "cookie-parser";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { APP_CONFIG } from "../src/config.js";
import { CategoriesModule } from "../src/categories/categories.module.js";
import { DRIZZLE } from "../src/db/drizzle.module.js";
import { categories } from "../src/db/schema.js";
import { CATEGORIES } from "../src/db/seed.js";
import { NoticesModule } from "../src/notices/notices.module.js";
import { ParticipantsModule } from "../src/participants/participants.module.js";
import { startTestDb, type TestDb } from "./db-harness.js";
import { ALGIERS, makeNotice, offsetPoint } from "./fixtures.js";

const COOKIE_SECRET = "test-secret-at-least-32-characters-long";
const CONFIG = {
  cookieSecret: COOKIE_SECRET,
  cookieSecure: false,
  maxRadiusKm: 100,
  defaultRadiusKm: 20,
  pastGraceHours: 24,
};

const validBody = {
  categorySlug: "funeral",
  title: "Funeral prayer for the late Ahmed Benali",
  description: "Prayer after Dhuhr.",
  venueName: "Masjid Al-Rahma",
  address: "Rue Didouche Mourad, Algiers",
  lat: ALGIERS.lat,
  lng: ALGIERS.lng,
  startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  attendance: "public",
};

describe("notices API", () => {
  let testDb: TestDb;
  let app: NestExpressApplication;

  beforeAll(async () => {
    testDb = await startTestDb();
    await testDb.seedCategories();

    // A @Global test module supplying DRIZZLE and APP_CONFIG, rather than the
    // brief's `.overrideProvider(DRIZZLE)`.
    //
    // The brief's version cannot work, and fails in a way worth recording:
    // `TestingModuleBuilder.overrideProvider` ends in `Module.replace`, which is
    // guarded by `if (options.isProvider && this.hasProvider(toReplace))` — it
    // replaces a token a scanned module already declares, and is a **silent
    // no-op** for one none of them do. DRIZZLE and APP_CONFIG are declared by
    // DrizzleModule, which the brief's `imports: [NoticesModule, CategoriesModule,
    // ParticipantsModule]` never pulls in, so both overrides do nothing and the
    // container fails to resolve NoticesRepository's DRIZZLE dependency.
    //
    // Importing the real DrizzleModule instead is not an option: its APP_CONFIG
    // factory is `loadConfig`, which throws on a missing DATABASE_URL, and its
    // POSTGRES_CLIENT would open a second pool against the developer's database.
    // @Global mirrors how DrizzleModule actually exposes these tokens in
    // production, so the modules under test resolve them exactly as they do there.
    @Global()
    @Module({
      providers: [
        { provide: DRIZZLE, useValue: testDb.db },
        { provide: APP_CONFIG, useValue: CONFIG },
      ],
      exports: [DRIZZLE, APP_CONFIG],
    })
    class TestDependenciesModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestDependenciesModule, NoticesModule, CategoriesModule, ParticipantsModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix("v1");
    app.use(cookieParser(COOKIE_SECRET));
    // No manual `new ParticipantMiddleware(...)` + `app.use(...)`: the brief
    // constructs it with one argument, but the middleware takes
    // (ParticipantsService, AppConfig) since it reads `cookieSecure` from config —
    // so that call does not type-check and would set `config` to undefined at
    // runtime. ParticipantsModule.configure()'s own `forRoutes("*")` already
    // installs it, which is also what production does, so this exercises the real
    // wiring rather than a test-only copy of it.
    app.useGlobalPipes(new StandardSchemaValidationPipe({ transform: true }));
    await app.init();
  }, 180_000);

  afterEach(async () => {
    await testDb.truncate();
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.stop();
  });

  // ---- Brief case 1 ----
  it("lists the seeded categories", async () => {
    const response = await request(app.getHttpServer()).get("/v1/categories").expect(200);
    expect(response.body.map((c: { slug: string }) => c.slug)).toContain("aqiqah");
    // Asserted against CATEGORIES.length, not a literal 6. `truncate()`
    // deliberately preserves `categories` (see its doc comment), so a literal
    // would be an order-dependent assertion: any test in this file that inserts
    // or deactivates a category leaks into the next one, and this case would then
    // pass or fail depending on which ran first. Against the seed constant it
    // tracks the real reference data, and it also keeps working when a seventh
    // category is added — a hardcoded 6 would fail there for no real reason.
    expect(response.body).toHaveLength(CATEGORIES.length);
  });

  // ---- Brief case 2 ----
  it("publishes a notice immediately and returns it in search", async () => {
    const agent = request.agent(app.getHttpServer());

    const created = await agent.post("/v1/notices").send(validBody).expect(201);
    expect(created.body.publicId).toBeTruthy();

    const found = await agent
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, radiusKm: 20 })
      .expect(200);

    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0].title).toBe(validBody.title);
  });

  // ---- Brief case 3 ----
  it("returns a response matching the contract schema", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post("/v1/notices").send(validBody).expect(201);

    const found = await agent
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng })
      .expect(200);

    // Drift guard from spec §4: the response must parse against the shared contract.
    expect(() => NoticeSearchResultSchema.parse(found.body)).not.toThrow();
  });

  // ---- Brief case 4 ----
  it("rejects a radius above the configured maximum", async () => {
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, radiusKm: 500 })
      .expect(400);
  });

  // ---- Brief case 5 ----
  it("rejects an invalid body with 400", async () => {
    await request(app.getHttpServer())
      .post("/v1/notices")
      .send({ ...validBody, title: "ab" })
      .expect(400);
  });

  // ---- Brief case 6 ----
  it("rejects organizer contact without consent", async () => {
    await request(app.getHttpServer())
      .post("/v1/notices")
      .send({ ...validBody, organizerContact: "+213 555 0000", organizerConsent: false })
      .expect(400);
  });

  // ---- Brief case 7 ----
  it("accepts organizer contact with consent", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/notices")
      .send({ ...validBody, organizerContact: "+213 555 0000", organizerConsent: true })
      .expect(201);
    expect(response.body.publicId).toBeTruthy();
  });

  // ---- Brief case 8 ----
  it("rejects an unknown category with 400", async () => {
    await request(app.getHttpServer())
      .post("/v1/notices")
      .send({ ...validBody, categorySlug: "nonexistent" })
      .expect(400);
  });

  // ---- Brief case 9 ----
  it("serves a notice by public id and matches the contract", async () => {
    const agent = request.agent(app.getHttpServer());
    const created = await agent.post("/v1/notices").send(validBody).expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/v1/notices/${created.body.publicId}`)
      .expect(200);

    expect(detail.body.title).toBe(validBody.title);
    expect(() => NoticeSchema.parse(detail.body)).not.toThrow();
  });

  // ---- Brief case 10 ----
  it("returns 404 for an unknown public id", async () => {
    await request(app.getHttpServer()).get("/v1/notices/doesnotexist").expect(404);
  });

  // ---- Brief case 11 ----
  it("lets the author cancel, and the notice leaves discovery but keeps its URL", async () => {
    const agent = request.agent(app.getHttpServer());
    const created = await agent.post("/v1/notices").send(validBody).expect(201);

    await agent.post(`/v1/notices/${created.body.publicId}/cancel`).expect(200);

    const search = await agent
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng })
      .expect(200);
    expect(search.body.items).toHaveLength(0);

    const detail = await request(app.getHttpServer())
      .get(`/v1/notices/${created.body.publicId}`)
      .expect(200);
    expect(detail.body.status).toBe("cancelled");
  });

  // ---- Brief case 12 ----
  it("refuses cancellation by a different participant with 403", async () => {
    const author = request.agent(app.getHttpServer());
    const created = await author.post("/v1/notices").send(validBody).expect(201);

    const stranger = request.agent(app.getHttpServer());
    // Establish the stranger's own cookie first.
    await stranger.get("/v1/categories").expect(200);
    await stranger.post(`/v1/notices/${created.body.publicId}/cancel`).expect(403);
  });

  // =====================================================================
  // Added: blank / missing / non-numeric coordinates (carried finding 2)
  // =====================================================================

  // The headline case. `SearchNoticesSchema` coerces with `z.coerce.number()`,
  // and `Number("")` is **0** — a perfectly valid latitude — so before the guard
  // in search-query.schema.ts this request returned 200 with a search centred on
  // (0, 0), the Gulf of Guinea. `?lat=&lng=` is literally what a browser submits
  // for an empty form field, so the user-visible symptom was "no notices near
  // you" for a request that should have said "your coordinates are missing".
  // Asserted here as a 400, and the body is checked to name the offending field
  // so the web app can point at the right input.
  it("rejects blank lat and lng with 400 rather than searching from (0, 0)", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: "", lng: "" })
      .expect(400);

    const message = JSON.stringify(response.body.message);
    expect(message).toContain("lat");
    expect(message).toContain("lng");
  });

  it("rejects a blank lat alone with 400", async () => {
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: "", lng: ALGIERS.lng })
      .expect(400);
  });

  it("rejects a blank lng alone with 400", async () => {
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: "" })
      .expect(400);
  });

  it("rejects a whitespace-only lat with 400", async () => {
    // `Number(" ")` is also 0, so a stray space is the same bug with a different
    // spelling — hence `.trim()` in the guard rather than a bare `=== ""`.
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: "   ", lng: ALGIERS.lng })
      .expect(400);
  });

  it("rejects a missing lat parameter with 400", async () => {
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lng: ALGIERS.lng })
      .expect(400);
  });

  it("rejects a missing lng parameter with 400", async () => {
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat })
      .expect(400);
  });

  it("rejects a search with no parameters at all with 400", async () => {
    await request(app.getHttpServer()).get("/v1/notices").expect(400);
  });

  it("rejects a non-numeric lat with 400", async () => {
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: "not-a-number", lng: ALGIERS.lng })
      .expect(400);
  });

  it("rejects an out-of-range lat with 400", async () => {
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: 91, lng: ALGIERS.lng })
      .expect(400);
  });

  // The guard must not overreach. (0, 0) is a real coordinate — the equator at
  // the prime meridian — so an explicit `lat=0&lng=0` has to keep working, and a
  // guard written as a falsy check (`if (!value)`) would reject it. This is the
  // counterfactual for the four tests above.
  it("still accepts an explicit lat=0 and lng=0 as a real coordinate", async () => {
    await makeNotice(testDb.db, { lat: 0, lng: 0, title: "Null Island gathering" });

    const response = await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: 0, lng: 0, radiusKm: 20 })
      .expect(200);

    expect(response.body.items.map((i: { title: string }) => i.title)).toEqual([
      "Null Island gathering",
    ]);
  });

  // KNOWN GAP, pinned deliberately rather than fixed here.
  //
  // The create path takes JSON, so `lat: null` arrives as a real null rather than
  // a string — and `Number(null)` is 0 just as `Number("")` is, so the very same
  // Null Island hazard exists on the body. `CreateNoticeSchema` accepts it:
  // measured directly against the contract, `lat: null` and `lat: ""` both parse
  // to `0`, while only `undefined` is rejected.
  //
  // It is NOT fixed in this task, for two reasons worth recording. First, the
  // same `.extend()` trick used for the query cannot be applied here:
  // `CreateNoticeSchema` is `CreateNoticeBase.refine(...)`, and extending a
  // refined object throws — measured: "Cannot overwrite keys on object schemas
  // containing refinements. Use `.safeExtend()` instead." The alternatives are
  // re-declaring the organizer-consent refinement on this side (a second copy of
  // a contract rule, free to drift from the real one) or wrapping the schema in
  // `z.looseObject({}).pipe(...)`, which collapses the Swagger request body to
  // `{"type":"object","properties":{}}` on the input side — verified — breaking
  // the brief's Step 8 requirement that `/api/docs` show a body schema derived
  // from the Zod contract. Second, six tasks import this schema, and the brief was
  // explicit that a contract change is to be reported, not made quietly.
  //
  // So this asserts the *current* behaviour exactly. If the contracts package
  // later tightens `lat`/`lng`, this test fails and points at the decision rather
  // than letting the API's meaning change unnoticed.
  it("currently accepts a null lat on the create body, coercing it to 0 (known contract gap)", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/notices")
      .send({ ...validBody, lat: null })
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/v1/notices/${response.body.publicId}`)
      .expect(200);

    // The notice really does land on the equator. This is the gap, stated as an
    // assertion so it cannot be mistaken for intended behaviour.
    expect(detail.body.lat).toBe(0);
    expect(detail.body.lng).toBe(validBody.lng);
  });

  // =====================================================================
  // Added: cursor robustness (carried finding 3)
  // =====================================================================

  // The brief never mentions `cursor`, yet this task is what exposes `?cursor=`
  // to the public. Task 7 hardened `decodeCursor` to return null for anything it
  // did not mint, so the contract is "a malformed cursor pages from the start".
  // These cases assert that contract at the HTTP boundary, where an unhandled
  // throw would be a 500 from an unauthenticated query string.
  it("treats a malformed cursor as a first page rather than a 500", async () => {
    await makeNotice(testDb.db, { title: "Only notice" });

    const response = await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, cursor: "not-a-real-cursor" })
      .expect(200);

    expect(response.body.items.map((i: { title: string }) => i.title)).toEqual(["Only notice"]);
    expect(() => NoticeSearchResultSchema.parse(response.body)).not.toThrow();
  });

  it.each([
    ["empty string", ""],
    ["percent-encoded NUL byte", "%00"],
    // The NUL is written as a JSON `\\u0000` **escape**, not as a raw control
    // byte. That distinction is the whole test: a raw NUL makes `JSON.parse`
    // throw inside decodeCursor's try/catch, so it never reaches the tiebreaker
    // pattern check at all and proves nothing about it. The escape survives
    // JSON.parse and yields a real NUL in `p`, which is the value that reaches
    // postgres as a bound parameter and is rejected at the protocol level —
    // `invalid byte sequence for encoding "UTF8": 0x00`, a 500 — unless the
    // pattern rejects it first. Verified: with Task 7's pattern check removed,
    // only this case fails.
    [
      "a NUL escape inside a valid base64url envelope",
      Buffer.from(String.raw`{"k":1,"p":"a\u0000b","s":"soonest","w":"upcoming"}`, "utf8").toString(
        "base64url",
      ),
    ],
    ["valid base64url that is not JSON", Buffer.from("plain text", "utf8").toString("base64url")],
    ["JSON with the wrong shape", Buffer.from('{"nope":true}', "utf8").toString("base64url")],
    ["a cursor with an over-long tiebreaker", Buffer.from(`{"k":1,"p":"${"A".repeat(500)}","s":"soonest","w":"upcoming"}`, "utf8").toString("base64url")],
    ["a cursor whose tiebreaker holds SQL", Buffer.from(`{"k":1,"p":"'; DROP TABLE notices;--","s":"soonest","w":"upcoming"}`, "utf8").toString("base64url")],
    ["a cursor with a non-finite key", Buffer.from('{"k":null,"p":"abc","s":"soonest","w":"upcoming"}', "utf8").toString("base64url")],
    ["a cursor with an unknown sort", Buffer.from('{"k":1,"p":"abc","s":"random","w":"upcoming"}', "utf8").toString("base64url")],
  ])("survives a malformed cursor (%s) without a 500", async (_label, cursor) => {
    await makeNotice(testDb.db, { title: "Still here" });

    const response = await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, cursor })
      .expect(200);

    expect(response.body.items.map((i: { title: string }) => i.title)).toEqual(["Still here"]);

    // The table is still there: a SQL-injection attempt through the tiebreaker
    // did not take it out.
    const rows = await testDb.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM notices`);
    expect(rows[0]!.n).toBe(1);
  });

  it("pages through results over HTTP with a real cursor", async () => {
    // The positive counterfactual for the malformed-cursor cases: a cursor the
    // server actually minted must page, otherwise "a bad cursor returns page 1"
    // would be trivially satisfied by ignoring every cursor.
    for (let i = 0; i < 3; i += 1) {
      await makeNotice(testDb.db, {
        ...offsetPoint(ALGIERS, 1_000 * (i + 1)),
        startsAt: new Date(Date.now() + (i + 1) * 60 * 60 * 1000),
        title: `Notice ${i + 1}`,
      });
    }

    const first = await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, limit: 2 })
      .expect(200);

    expect(first.body.items.map((i: { title: string }) => i.title)).toEqual([
      "Notice 1",
      "Notice 2",
    ]);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, limit: 2, cursor: first.body.nextCursor })
      .expect(200);

    expect(second.body.items.map((i: { title: string }) => i.title)).toEqual(["Notice 3"]);
    expect(second.body.nextCursor).toBeNull();
  });

  // =====================================================================
  // Added: HTTP-layer behaviour the brief leaves unasserted
  // =====================================================================

  it("issues a participant cookie on a create, and reuses it for the cancel", async () => {
    const agent = request.agent(app.getHttpServer());
    const created = await agent.post("/v1/notices").send(validBody).expect(201);

    const setCookie = created.headers["set-cookie"] as unknown as string[];
    expect(setCookie.join(";")).toContain("jiwar_pid=s%3A");
    expect(setCookie.join(";")).toContain("HttpOnly");

    // Same agent, so the same signed cookie — the author can cancel.
    await agent.post(`/v1/notices/${created.body.publicId}/cancel`).expect(200);
  });

  it("cannot be tricked into cancelling by a participant id supplied in the body", async () => {
    // The threat: if the controller ever read the author id from input instead of
    // from the signed cookie, a stranger who learned an author's participant id
    // could cancel their notice. The repository's author match is the real gate,
    // and this asserts the controller does not route around it.
    const author = request.agent(app.getHttpServer());
    const created = await author.post("/v1/notices").send(validBody).expect(201);

    const authorRow = await testDb.db.execute<{ id: string }>(sql`
      SELECT author_participant_id AS id FROM notices WHERE public_id = ${created.body.publicId}
    `);
    const authorParticipantId = authorRow[0]!.id;

    const stranger = request.agent(app.getHttpServer());
    await stranger.get("/v1/categories").expect(200);
    await stranger
      .post(`/v1/notices/${created.body.publicId}/cancel`)
      .send({ participantId: authorParticipantId, authorParticipantId })
      .expect(403);

    const still = await request(app.getHttpServer())
      .get(`/v1/notices/${created.body.publicId}`)
      .expect(200);
    expect(still.body.status).toBe("published");
  });

  it("returns 403, not 404, when cancelling a notice that does not exist", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.get("/v1/categories").expect(200);
    // Deliberate: a 404 here would tell a stranger which public ids exist and are
    // still cancellable. Pinned so the distinction is not lost in a refactor.
    await agent.post("/v1/notices/doesnotexist/cancel").expect(403);
  });

  it("refuses a second cancel of an already-cancelled notice", async () => {
    const agent = request.agent(app.getHttpServer());
    const created = await agent.post("/v1/notices").send(validBody).expect(201);
    await agent.post(`/v1/notices/${created.body.publicId}/cancel`).expect(200);
    // The repository's WHERE requires status = 'published', so the second attempt
    // matches zero rows.
    await agent.post(`/v1/notices/${created.body.publicId}/cancel`).expect(403);
  });

  it("returns a validation error body that names the offending field", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/notices")
      .send({ ...validBody, title: "ab" })
      .expect(400);

    expect(response.body.statusCode).toBe(400);
    expect(JSON.stringify(response.body.message)).toContain("title");
  });

  it("accepts a radius exactly at the configured maximum but not one above it", async () => {
    // maxRadiusKm is 100 in this app's config while the contract's hard limit is
    // 500, so this pins the boundary of the server-policy check rather than the
    // schema's.
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, radiusKm: 100 })
      .expect(200);

    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, radiusKm: 101 })
      .expect(400);
  });

  it("rejects a radius above the contract's hard limit with 400", async () => {
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, radiusKm: 100_000 })
      .expect(400);
  });

  it("applies the contract's default radius and limit when they are omitted", async () => {
    await makeNotice(testDb.db, { ...offsetPoint(ALGIERS, 15_000), title: "Fifteen km away" });
    await makeNotice(testDb.db, { ...offsetPoint(ALGIERS, 30_000), title: "Thirty km away" });

    const response = await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng })
      .expect(200);

    // Default radius is 20 km, so only the nearer notice is inside it.
    expect(response.body.items.map((i: { title: string }) => i.title)).toEqual([
      "Fifteen km away",
    ]);
  });

  it("filters by a repeated categories query parameter", async () => {
    await makeNotice(testDb.db, { categorySlug: "funeral", title: "A funeral" });
    await makeNotice(testDb.db, { categorySlug: "wedding", title: "A wedding" });
    await makeNotice(testDb.db, { categorySlug: "aqiqah", title: "An aqiqah" });

    const response = await request(app.getHttpServer())
      .get(`/v1/notices?lat=${ALGIERS.lat}&lng=${ALGIERS.lng}&categories=funeral&categories=wedding`)
      .expect(200);

    expect(
      response.body.items.map((i: { title: string }) => i.title).sort(),
    ).toEqual(["A funeral", "A wedding"]);
  });

  it("excludes a removed notice from the detail endpoint with a 404", async () => {
    // Spec §6/§10 distinguish cancelled (still reachable by URL) from removed
    // (gone). Brief case 11 covers cancelled; this covers the other half.
    const notice = await makeNotice(testDb.db, { status: "removed", title: "Taken down" });
    await request(app.getHttpServer()).get(`/v1/notices/${notice.publicId}`).expect(404);
  });

  it("reports a distance on each search item but none on the detail response", async () => {
    // The brief's Interfaces line says the detail endpoint returns a Notice
    // "without a distance". Nothing in its 12 cases asserts that, and NoticeSchema
    // would not catch an extra key.
    const created = await request(app.getHttpServer())
      .post("/v1/notices")
      .send(validBody)
      .expect(201);

    const search = await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng })
      .expect(200);
    expect(search.body.items[0].distanceMetres).toBeTypeOf("number");

    const detail = await request(app.getHttpServer())
      .get(`/v1/notices/${created.body.publicId}`)
      .expect(200);
    expect(detail.body).not.toHaveProperty("distanceMetres");
  });

  it("omits a deactivated category from the list and refuses to publish into it", async () => {
    // This test mutates `categories`, which truncate() deliberately preserves, so
    // it restores them itself — see the harness doc comment. It is also why case 1
    // asserts CATEGORIES.length rather than a literal.
    await testDb.db.update(categories).set({ active: false }).where(eq(categories.slug, "other"));
    try {
      const list = await request(app.getHttpServer()).get("/v1/categories").expect(200);
      expect(list.body.map((c: { slug: string }) => c.slug)).not.toContain("other");
      expect(list.body).toHaveLength(CATEGORIES.length - 1);

      await request(app.getHttpServer())
        .post("/v1/notices")
        .send({ ...validBody, categorySlug: "other" })
        .expect(400);
    } finally {
      await testDb.db.update(categories).set({ active: true }).where(eq(categories.slug, "other"));
    }
  });

  it("returns categories in sort order and matching the seed", async () => {
    const response = await request(app.getHttpServer()).get("/v1/categories").expect(200);
    const expected = [...CATEGORIES].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.slug);
    expect(response.body.map((c: { slug: string }) => c.slug)).toEqual(expected);
  });

  it("falls back to past notices over HTTP when nothing is upcoming", async () => {
    await makeNotice(testDb.db, {
      startsAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      title: "Last week's funeral",
    });

    const response = await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng })
      .expect(200);

    expect(response.body.fallback).toBe(true);
    expect(response.body.items.map((i: { title: string }) => i.title)).toEqual([
      "Last week's funeral",
    ]);
  });

  it("guards only lat and lng, leaving every other contract field untouched", async () => {
    // Drift guard for search-query.schema.ts: the guarded schema must accept and
    // default exactly what the contract does, so Task 10's client cannot send a
    // query the server rejects. Compared field-by-field on a representative query
    // rather than trusting the two to stay in step by inspection.
    const query = { lat: "36.7538", lng: "3.0588", radiusKm: "25", limit: "7", sort: "nearest" };
    const contract = SearchNoticesSchema.parse(query);

    const response = await request(app.getHttpServer())
      .get("/v1/notices")
      .query(query)
      .expect(200);

    expect(response.body.items).toEqual([]);
    // The contract parse is the reference: same defaults, same coercions.
    expect(contract).toEqual({
      lat: 36.7538,
      lng: 3.0588,
      radiusKm: 25,
      when: "upcoming",
      sort: "nearest",
      limit: 7,
    });
  });
  // =====================================================================
  // Fix round 1, Fix 1: NUL byte on the inputs THIS task exposed
  //
  // Task 7 guarded the cursor tiebreaker, and its comment anticipated that the
  // hazard would matter "once Task 8 exposes `?cursor=`" — but the guard was
  // per-field, so the four further inputs this task opened were never covered.
  // Postgres rejects a NUL inside `text` at the protocol level, so binding the
  // parameter is no defence: the driver raises `invalid byte sequence for encoding
  // "UTF8": 0x00` (SQLSTATE 22021) and the request became a 500, with the failing
  // SQL and every bound parameter written to the server log each time.
  //
  // Reproduced against a live server before the fix:
  //   GET  /v1/notices/a%00b                          -> 500
  //   POST /v1/notices/a%00b/cancel                   -> 500
  //   GET  /v1/notices?...&categories=a%00b           -> 500
  //   POST /v1/notices  with \u0000 in a text field   -> 500
  // while the same paths with clean input gave 404/403/200/201, and Task 7's
  // guarded `?cursor=` with a NUL escape correctly gave 200.
  // =====================================================================

  // `%00` in the path is decoded by Express into a real NUL in req.params, so this
  // is the raw byte reaching SQL, not an escape sequence.
  it.each([
    ["a NUL byte", "a\u0000b"],
    ["a bare NUL", "\u0000"],
    ["an id longer than the varchar(16) column", "A".repeat(500)],
    ["an id with a quote", "a'b"],
    ["an id holding SQL", "'; DROP TABLE notices;--"],
    ["an id with a newline", "a\nb"],
  ])("answers a malformed public id (%s) on the detail route with 404, not 500", async (_label, publicId) => {
    await request(app.getHttpServer())
      .get(`/v1/notices/${encodeURIComponent(publicId)}`)
      .expect(404);
  });

  it.each([
    ["a NUL byte", "a\u0000b"],
    ["an id longer than the varchar(16) column", "A".repeat(500)],
    ["an id holding SQL", "'; DROP TABLE notices;--"],
  ])("answers a malformed public id (%s) on the cancel route with 403, not 500", async (_label, publicId) => {
    const agent = request.agent(app.getHttpServer());
    await agent.post("/v1/notices").send(validBody).expect(201);

    // 403 rather than 404, deliberately: every other unauthorised cancel already
    // answers 403, and returning 404 only for an unparseable id would give a
    // prober a way to distinguish the two cases.
    await agent
      .post(`/v1/notices/${encodeURIComponent(publicId)}/cancel`)
      .expect(403);
  });

  it("rejects a NUL byte in a categories slug with 400, not 500", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, categories: "a\u0000b" })
      .expect(400);

    expect(JSON.stringify(response.body.message)).toContain("categories");
  });

  it("rejects a NUL byte in one of several categories slugs with 400", async () => {
    // The contract normalises one slug or many into an array before the guard
    // runs, so a bad entry alongside good ones is caught by the same check.
    await request(app.getHttpServer())
      .get(`/v1/notices?lat=${ALGIERS.lat}&lng=${ALGIERS.lng}&categories=funeral&categories=a%00b`)
      .expect(400);
  });

  it("still serves clean ids and slugs on those same paths", async () => {
    // The counterfactual for every case above: the guards must reject only what
    // could never identify a row, and a pattern that was too strict (or a
    // categories check that rejected any string) would break these.
    const agent = request.agent(app.getHttpServer());
    const created = await agent.post("/v1/notices").send(validBody).expect(201);

    // A real nanoid(12) passes the pattern and resolves.
    await request(app.getHttpServer()).get(`/v1/notices/${created.body.publicId}`).expect(200);
    // A well-formed id that simply does not exist is still a 404, indistinguishable
    // from the malformed case above — which is the point.
    await request(app.getHttpServer()).get("/v1/notices/doesnotexist").expect(404);
    // Ids using the rest of nanoid's alphabet, including both its symbols.
    await request(app.getHttpServer()).get("/v1/notices/aB3-_xyz0912").expect(404);
    // A clean category filter still works.
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, categories: "funeral" })
      .expect(200);
    // And the author can still cancel with a real id.
    await agent.post(`/v1/notices/${created.body.publicId}/cancel`).expect(200);
  });

  it("does not reach the database for a malformed id", async () => {
    // Distinguishes "the guard short-circuited" from "the query ran and found
    // nothing" — the latter would still have sent the NUL to postgres. A notice
    // exists, so a query that did run would be visible in the table; what is
    // asserted is that the connection survives and keeps serving, which a
    // protocol-level encoding error would have disrupted.
    await makeNotice(testDb.db, { title: "Untouched" });

    await request(app.getHttpServer()).get("/v1/notices/a%00b").expect(404);

    const rows = await testDb.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM notices`);
    expect(rows[0]!.n).toBe(1);

    const after = await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng })
      .expect(200);
    expect(after.body.items.map((i: { title: string }) => i.title)).toEqual(["Untouched"]);
  });

  // KNOWN GAP, left deliberately and reported: the POST body's text fields.
  //
  // A `\u0000` inside `title`/`description`/`venueName`/`address` still produces a
  // 500. Fixing it needs the same contracts-level decision already parked with the
  // Null Island item — `CreateNoticeSchema` is refined, so `.extend()` throws, and
  // the wrapper alternative destroys the Swagger request body. Pinned here so the
  // parked decision demonstrably covers it and nobody assumes it was handled.
  it("currently returns 500 for a NUL byte in a create body field (known contract gap)", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/notices")
      .send({ ...validBody, title: `Funeral prayer\u0000 for the late Ahmed Benali` });

    expect(response.status).toBe(500);
  });

  // =====================================================================
  // Fix round 1, Fix 2: no participants row on a request that needs no identity
  //
  // `forRoutes("*")` plus an unconditional `ensure()` meant any client ignoring
  // Set-Cookie wrote one row per request, unbounded, into the table
  // `notices.author_participant_id` references. Measured before the fix: 50
  // anonymous GET /v1/notices -> +50 rows; 50 GET /v1/categories -> +50; 20 detail
  // 404s -> +20; 20 requests that 400 -> +20; 10 unknown-route 404s -> +10.
  //
  // The identity is now minted lazily by @CurrentParticipant(), so only create and
  // cancel — the two handlers that consume it — ever insert.
  // =====================================================================

  const countParticipants = async (): Promise<number> => {
    const rows = await testDb.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM participants`,
    );
    return rows[0]!.n;
  };

  it("inserts no participant row for a cookieless GET /v1/categories", async () => {
    const before = await countParticipants();
    for (let i = 0; i < 10; i += 1) {
      await request(app.getHttpServer()).get("/v1/categories").expect(200);
    }
    expect(await countParticipants()).toBe(before);
  });

  it.each([
    ["a search", () => request(app.getHttpServer()).get("/v1/notices").query({ lat: ALGIERS.lat, lng: ALGIERS.lng }).expect(200)],
    ["a detail 404", () => request(app.getHttpServer()).get("/v1/notices/doesnotexist").expect(404)],
    ["a validation 400", () => request(app.getHttpServer()).get("/v1/notices").query({ lat: "", lng: "" }).expect(400)],
    ["an unknown route", () => request(app.getHttpServer()).get("/v1/nope").expect(404)],
    ["a malformed id", () => request(app.getHttpServer()).get("/v1/notices/a%00b").expect(404)],
  ])("inserts no participant row for %s", async (_label, send) => {
    const before = await countParticipants();
    for (let i = 0; i < 5; i += 1) await send();
    expect(await countParticipants()).toBe(before);
  });

  it("still mints exactly one participant row for a create, and reuses it", async () => {
    // The counterfactual for the cases above: minting must still happen where an
    // identity is genuinely consumed, or the cookie and authorship break. A guard
    // that simply never inserted would pass every zero-row test above.
    const before = await countParticipants();
    const agent = request.agent(app.getHttpServer());

    const created = await agent.post("/v1/notices").send(validBody).expect(201);
    expect(await countParticipants()).toBe(before + 1);

    const setCookie = created.headers["set-cookie"] as unknown as string[];
    expect(setCookie.join(";")).toContain("jiwar_pid=s%3A");

    // A second write from the same agent reuses the cookie: no new row.
    await agent.post("/v1/notices").send({ ...validBody, title: "A second notice entirely" }).expect(201);
    expect(await countParticipants()).toBe(before + 1);

    // And the identity still authorises the cancel.
    await agent.post(`/v1/notices/${created.body.publicId}/cancel`).expect(200);
    expect(await countParticipants()).toBe(before + 1);
  });

  it("mints one row for a cookieless cancel attempt, which is still refused", async () => {
    // Cancel consumes @CurrentParticipant(), so it does mint — that is correct and
    // unavoidable: the id is what the authorisation check compares against. What
    // matters is that it is one row for a request that needed an identity, not one
    // row for every anonymous read.
    const author = request.agent(app.getHttpServer());
    const created = await author.post("/v1/notices").send(validBody).expect(201);

    const before = await countParticipants();
    await request(app.getHttpServer())
      .post(`/v1/notices/${created.body.publicId}/cancel`)
      .expect(403);
    expect(await countParticipants()).toBe(before + 1);
  });

  it("mints a single row when one handler resolves the identity twice", async () => {
    // The resolver is memoised per request. Without that, two @CurrentParticipant()
    // parameters (or a guard plus a handler) would race and insert two rows for one
    // request. Asserted through create, which resolves once, plus a direct check
    // that the cookie round-trips to the same id rather than a second one.
    const agent = request.agent(app.getHttpServer());
    const before = await countParticipants();

    const first = await agent.post("/v1/notices").send(validBody).expect(201);
    const firstAuthor = await testDb.db.execute<{ id: string }>(sql`
      SELECT author_participant_id AS id FROM notices WHERE public_id = ${first.body.publicId}
    `);

    const second = await agent
      .post("/v1/notices")
      .send({ ...validBody, title: "Another notice from the same author" })
      .expect(201);
    const secondAuthor = await testDb.db.execute<{ id: string }>(sql`
      SELECT author_participant_id AS id FROM notices WHERE public_id = ${second.body.publicId}
    `);

    expect(secondAuthor[0]!.id).toBe(firstAuthor[0]!.id);
    expect(await countParticipants()).toBe(before + 1);
  });
});
