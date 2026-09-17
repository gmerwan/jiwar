import { Controller, Get, Module } from "@nestjs/common";
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
import { ParticipantsService } from "../src/participants/participants.service.js";
import { startTestDb, type TestDb } from "./db-harness.js";

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
        { provide: APP_CONFIG, useValue: { cookieSecret: COOKIE_SECRET } },
      ],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.use(cookieParser(COOKIE_SECRET));
    const middleware = new ParticipantMiddleware(app.get(ParticipantsService));
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
});
