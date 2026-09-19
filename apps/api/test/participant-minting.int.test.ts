import { Controller, Global, Module, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_CONFIG } from "../src/config.js";
import { DRIZZLE } from "../src/db/drizzle.module.js";
import { CurrentParticipant } from "../src/participants/current-participant.decorator.js";
import { ParticipantsModule } from "../src/participants/participants.module.js";
import { startTestDb, type TestDb } from "./db-harness.js";

/**
 * A controller that consumes `@CurrentParticipant()` TWICE on one handler.
 *
 * This cannot be expressed through the real API — no route needs the identity
 * twice — so it is declared here, which is what `test/tsconfig.json` exists to
 * allow. It guards the memoisation in `ParticipantMiddleware`: Nest resolves a
 * handler's parameters concurrently (`await Promise.all(paramsOptions.map(...))`
 * in `createPipesFn`), so an unmemoised resolver races with itself and inserts a
 * row per parameter. Measured with the memoisation removed:
 *
 *   {"a":"fcaca443-...","b":"89abdf65-...","same":false}  rows = 2
 *
 * — two identities for one request, and the handler cannot tell which is "the"
 * participant. With memoisation: one id, `same: true`, one row. The same race
 * would appear in production the moment a guard and a handler both read the
 * identity, which is why this is a permanent test rather than a throwaway probe.
 */
@Controller("twice")
class TwiceController {
  @Post()
  post(@CurrentParticipant() a: string, @CurrentParticipant() b: string) {
    return { a, b, same: a === b };
  }
}

describe("participant identity is minted once per request", () => {
  let testDb: TestDb;
  let app: NestExpressApplication;

  beforeAll(async () => {
    testDb = await startTestDb();
    @Global()
    @Module({
      providers: [
        { provide: DRIZZLE, useValue: testDb.db },
        { provide: APP_CONFIG, useValue: { cookieSecret: "x".repeat(40), cookieSecure: false } },
      ],
      exports: [DRIZZLE, APP_CONFIG],
    })
    class Deps {}
    @Module({ controllers: [TwiceController], imports: [Deps, ParticipantsModule] })
    class M {}
    const ref = await Test.createTestingModule({ imports: [M] }).compile();
    app = ref.createNestApplication<NestExpressApplication>();
    app.use(cookieParser("x".repeat(40)));
    await app.init();
  }, 180_000);

  afterAll(async () => { await app?.close(); await testDb?.stop(); });

  it("inserts exactly one row for a handler resolving the identity twice", async () => {
    const res = await request(app.getHttpServer()).post("/twice").expect(201);
    const rows = await testDb.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM participants`,
    );

    // Both parameters see the same identity, and only one row was written.
    expect(res.body.same).toBe(true);
    expect(res.body.a).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0]!.n).toBe(1);
  });
});
