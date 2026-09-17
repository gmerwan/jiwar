import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { categories } from "./schema.js";

export interface CategorySeed {
  slug: string;
  name: string;
  icon: string;
  sortOrder: number;
}

/**
 * The canonical category list. Exported so the integration-test harness seeds
 * exactly what production seeds — a second copy in test code would let the two
 * drift, and Tasks 7 and 8 would then be querying categories that do not exist.
 */
export const CATEGORIES: readonly CategorySeed[] = [
  { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
  { slug: "wedding", name: "Wedding", icon: "wedding", sortOrder: 20 },
  { slug: "aqiqah", name: "Aqiqah", icon: "aqiqah", sortOrder: 30 },
  { slug: "memorial", name: "Memorial", icon: "memorial", sortOrder: 40 },
  { slug: "gathering", name: "Community Gathering", icon: "gathering", sortOrder: 50 },
  { slug: "other", name: "Other", icon: "other", sortOrder: 60 },
];

/**
 * Idempotent: safe to call on an already-seeded database.
 *
 * Generic over the schema so both callers fit: the CLI seeder passes a
 * schema-less `drizzle(sql)` handle, while the test harness passes one typed with
 * the full schema. A fixed generic argument would reject one or the other.
 */
export async function seedCategories<TSchema extends Record<string, unknown>>(
  db: PostgresJsDatabase<TSchema>,
): Promise<void> {
  for (const category of CATEGORIES) {
    await db.insert(categories).values(category).onConflictDoNothing({ target: categories.slug });
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "postgresql://jiwar:jiwar@localhost:55432/jiwar_dev";
  const sql = postgres(url);
  const db = drizzle(sql);

  await seedCategories(db);

  console.log(`Seeded ${CATEGORIES.length} categories.`);
  await sql.end();
}

// Only bootstrap when run as a script (`pnpm db:seed`). Importing this module for
// CATEGORIES/seedCategories must not connect to anything, or the test harness
// would silently seed the developer's database instead of its own container.
if (typeof require !== "undefined" && require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
