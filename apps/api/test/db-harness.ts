import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { JiwarDb } from "../src/db/drizzle.module.js";
import { schema } from "../src/db/schema.js";
import { seedCategories as seedCategoryRows } from "../src/db/seed.js";

/**
 * Same type as the application's `JiwarDb`, aliased rather than re-declared so a
 * later change to the schema generic cannot make test code and production code
 * disagree about what a database handle is.
 */
export type JiwarTestDb = JiwarDb;

export interface TestDb {
  db: JiwarTestDb;
  url: string;
  stop(): Promise<void>;
  truncate(): Promise<void>;
  seedCategories(): Promise<void>;
}

/**
 * `imresamu/postgis` rather than the canonical `postgis/postgis`: the official
 * tags publish amd64 only, so on Apple Silicon they either fail to pull or run
 * under emulation. This must stay identical to docker-compose.yml, otherwise the
 * tests and the dev database are different PostGIS builds.
 */
const POSTGIS_IMAGE = "imresamu/postgis:18-3.6";

/**
 * Resolved from this file's own directory rather than from `process.cwd()`, so the
 * harness runs the same migrations no matter which directory vitest was invoked
 * from. These are the real migrations that ship to production — a hand-written DDL
 * copy would be free to drift from the dev schema, and the integration tests would
 * then be asserting against a database shape that never actually exists.
 */
// `__dirname` rather than `import.meta.url`: this package has no `"type": "module"`,
// so it compiles as CommonJS and `import.meta` is a type error there (TS1470).
// Vitest supplies both at runtime, but only this one type-checks.
const MIGRATIONS_FOLDER = join(__dirname, "../src/db/migrations");

/**
 * Boots a throwaway PostGIS container, runs the real migrations against it and
 * returns a Drizzle handle. Deliberately does NOT touch the Compose dev database
 * on port 55432: an integration test that truncates tables must never be able to
 * wipe a developer's data.
 */
export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGIS_IMAGE)
    .withDatabase("jiwar_test")
    .withUsername("jiwar")
    .withPassword("jiwar")
    .start();

  const url = container.getConnectionUri();
  const client = postgres(url, { max: 5 });
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    url,
    async stop() {
      // The pool is drained before the container goes away. In the other order,
      // postgres-js is left holding sockets to a host that has stopped
      // answering, and the process hangs on those open handles.
      await client.end();
      await container.stop();
    },
    /**
     * Clears `notices` and `participants` between tests. **`categories` is
     * deliberately NOT truncated** — that is the intended design, not an
     * oversight: tests seed categories once in `beforeAll` and call this per
     * test, so reference data has to survive. Adding `categories` here would
     * empty the table out from under every notice fixture's foreign key.
     *
     * Two consequences a test author has to know about:
     *
     * 1. **Mutations to `categories` leak between tests in the same file.**
     *    An inserted row, or an `active = false` flip, is still there in the
     *    next test — measured: after inserting one extra category and
     *    deactivating `funeral`, the following test saw `count = 7` and
     *    `funeral.active = false`. A test that mutates `categories` owns
     *    restoring them (undo it in `afterEach`, or re-seed).
     *
     * 2. **`RESTART IDENTITY` does not reset `categories_id_seq`**, because
     *    that clause only touches the tables named in the statement — measured:
     *    `last_value` stayed at 7 across a truncate. So category ids are not
     *    stable or predictable across runs, and no fixture should hardcode one.
     *    Look ids up by `slug` instead.
     */
    async truncate() {
      await db.execute(sql`TRUNCATE TABLE notices, participants RESTART IDENTITY CASCADE`);
    },
    async seedCategories() {
      await seedCategoryRows(db);
    },
  };
}
