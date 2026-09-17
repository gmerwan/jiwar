import { createHmac, randomUUID } from "node:crypto";
import { Controller, Get, Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_CONFIG } from "../src/config.js";
import { DRIZZLE } from "../src/db/drizzle.module.js";
import { CurrentParticipant } from "../src/participants/current-participant.decorator.js";
import { ParticipantMiddleware } from "../src/participants/participant.middleware.js";
import { ParticipantsModule } from "../src/participants/participants.module.js";
import { ParticipantsService } from "../src/participants/participants.service.js";
import { startTestDb, type TestDb } from "./db-harness.js";

/**
 * Signs a cookie value the same way `cookie-signature@1.2.2` (the package
 * `cookie-parser` and `res.cookie({ signed: true })` both use, per the
 * pnpm override in pnpm-workspace.yaml) does: `value + "." + base64(hmacSha256(value))`
 * with the trailing `=` padding stripped, prefixed with the `s:` that
 * `express`'s `res.cookie` adds for a signed cookie. Reimplemented here with
 * plain `node:crypto` rather than importing `cookie-signature` directly,
 * since it is a transitive dependency of `cookie-parser`, not a direct one.
 */
function signCookieValue(value: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(value).digest("base64").replace(/=+$/, "");
  return `s:${value}.${signature}`;
}

@Controller("whoami")
class WhoAmIController {
  @Get()
  get(@CurrentParticipant() participantId: string) {
    return { participantId };
  }
}

const COOKIE_SECRET = "test-secret-at-least-32-characters-long";

describe("participant cookie", () => {
  let testDb: TestDb;
  let app: NestExpressApplication;

  beforeAll(async () => {
    testDb = await startTestDb();

    @Module({
      controllers: [WhoAmIController],
      providers: [
        ParticipantsService,
        { provide: DRIZZLE, useValue: testDb.db },
        { provide: APP_CONFIG, useValue: { cookieSecret: COOKIE_SECRET, cookieSecure: false } },
      ],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.use(cookieParser(COOKIE_SECRET));
    const middleware = new ParticipantMiddleware(app.get(ParticipantsService), app.get(APP_CONFIG));
    app.use(middleware.use.bind(middleware));
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.stop();
  });

  it("issues a participant cookie on first request", async () => {
    const response = await request(app.getHttpServer()).get("/whoami").expect(200);
    const setCookie = response.headers["set-cookie"] as unknown as string[];
    expect(setCookie.join(";")).toContain("jiwar_pid=");
    expect(setCookie.join(";")).toContain("HttpOnly");
    expect(setCookie.join(";")).toContain("SameSite=Lax");
    expect(response.body.participantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reuses the same participant id on a second request with the cookie", async () => {
    const agent = request.agent(app.getHttpServer());
    const first = await agent.get("/whoami").expect(200);
    const second = await agent.get("/whoami").expect(200);
    expect(second.body.participantId).toBe(first.body.participantId);
  });

  it("creates a new participant when no cookie is sent", async () => {
    const a = await request(app.getHttpServer()).get("/whoami").expect(200);
    const b = await request(app.getHttpServer()).get("/whoami").expect(200);
    expect(a.body.participantId).not.toBe(b.body.participantId);
  });

  it("stores no personal data on the participant row", async () => {
    await request(app.getHttpServer()).get("/whoami").expect(200);
    const columns = await testDb.db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'participants'
    `);
    expect(columns.map((c) => c.column_name).sort()).toEqual(["created_at", "id"]);
  });

  it("issues a fresh id when the cookie signature is invalid", async () => {
    const response = await request(app.getHttpServer())
      .get("/whoami")
      .set("Cookie", "jiwar_pid=s:forged-value.bad-signature")
      .expect(200);
    expect(response.body.participantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  // Unlike the previous case, the forged value here IS UUID-shaped — it is a
  // real, previously-issued participant id ("the victim's") with a garbage
  // signature appended. This is the case that actually distinguishes "the
  // signature was checked and rejected" from "the value merely failed the
  // UUID-format check": a forged value that is not UUID-shaped would be
  // rejected by ParticipantsService.ensure()'s own regex even with signature
  // verification removed entirely, so it proves nothing about verification on
  // its own. Replaying a real UUID with a bad signature closes that gap: if
  // signature verification were ever silently dropped, this is the test that
  // would catch an attacker impersonating another visitor well enough to
  // cancel that visitor's notice (the exact threat Task 8 builds on).
  it("does not let a forged cookie carrying another participant's real id impersonate them", async () => {
    const victim = await request(app.getHttpServer()).get("/whoami").expect(200);
    const victimId = victim.body.participantId as string;

    const forgedCookie = `jiwar_pid=s:${victimId}.GARBAGE_SIGNATURE`;
    const attacker = await request(app.getHttpServer())
      .get("/whoami")
      .set("Cookie", forgedCookie)
      .expect(200);

    expect(attacker.body.participantId).not.toBe(victimId);
    expect(attacker.body.participantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  // Sign a UUID with the real secret — so it passes signature verification —
  // that was never inserted into `participants`. Every earlier "forged
  // cookie" test in this file used a bad signature, so a version of
  // `ParticipantsService.ensure()` that skipped the DB lookup entirely (e.g.
  // `return existingId;`) would still pass them: the request never reaches
  // the point where a missing row would matter. This test closes that gap by
  // presenting a value the signature layer accepts, so only the row lookup
  // stands between it and impersonating a participant that does not exist.
  it("issues a fresh id when a validly signed cookie names a participant absent from the database", async () => {
    const unknownId = randomUUID();
    const cookie = `jiwar_pid=${signCookieValue(unknownId, COOKIE_SECRET)}`;

    const response = await request(app.getHttpServer())
      .get("/whoami")
      .set("Cookie", cookie)
      .expect(200);

    expect(response.body.participantId).not.toBe(unknownId);
    expect(response.body.participantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  // The first test in this file already checks HttpOnly and SameSite=Lax, but
  // stops there. A cookie stripped of `secure`, `maxAge` and `path` in
  // `res.cookie()` would still pass that assertion untouched. This test adds
  // the remaining attributes the brief specifies: `Path=/`, a `Max-Age` (only
  // present at all when `maxAge` is set — its absence, not just a wrong
  // value, is the signal that the option was dropped), and the `s%3A` prefix
  // that `Set-Cookie`'s percent-encoding produces only for a signed value.
  it("issues a cookie with Path=/, a Max-Age, and the signed-value prefix", async () => {
    const response = await request(app.getHttpServer()).get("/whoami").expect(200);
    const setCookie = (response.headers["set-cookie"] as unknown as string[]).join(";");

    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toMatch(/Max-Age=\d+/);
    expect(setCookie).toContain("jiwar_pid=s%3A");
  });
});

// A second, independent app instance is used for this suite because it must
// boot the way `app.module.ts` does — importing `ParticipantsModule` itself
// rather than manually constructing `ParticipantMiddleware` and wiring it
// with `app.use()`, as the describe block above does for convenience. That
// manual wiring never calls `ParticipantsModule.configure()`, so a broken
// `forRoutes("*")` in `participants.module.ts` (e.g. changed to a path that
// never matches) cannot be caught by any test that reuses it.
describe("participant cookie via ParticipantsModule's own wiring", () => {
  let testDb: TestDb;
  let app: NestExpressApplication;

  const COOKIE_SECRET = "test-secret-at-least-32-characters-long";

  beforeAll(async () => {
    testDb = await startTestDb();

    @Global()
    @Module({
      providers: [
        { provide: DRIZZLE, useValue: testDb.db },
        { provide: APP_CONFIG, useValue: { cookieSecret: COOKIE_SECRET, cookieSecure: false } },
      ],
      exports: [DRIZZLE, APP_CONFIG],
    })
    class TestDependenciesModule {}

    @Module({
      controllers: [WhoAmIController],
      imports: [TestDependenciesModule, ParticipantsModule],
    })
    class WiringTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [WiringTestModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.use(cookieParser(COOKIE_SECRET));
    // Matches main.ts's app.setGlobalPrefix("v1"), so the route this test
    // hits is the same shape a real request would use in production.
    app.setGlobalPrefix("v1");
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.stop();
  });

  it("issues the participant cookie on a v1-prefixed route through ParticipantsModule's real forRoutes wiring", async () => {
    const response = await request(app.getHttpServer()).get("/v1/whoami").expect(200);
    const setCookie = response.headers["set-cookie"] as unknown as string[];
    expect(setCookie.join(";")).toContain("jiwar_pid=");
    expect(response.body.participantId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
