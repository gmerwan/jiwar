import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { categories } from "./schema.js";

const CATEGORIES = [
  { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
  { slug: "wedding", name: "Wedding", icon: "wedding", sortOrder: 20 },
  { slug: "aqiqah", name: "Aqiqah", icon: "aqiqah", sortOrder: 30 },
  { slug: "memorial", name: "Memorial", icon: "memorial", sortOrder: 40 },
  { slug: "gathering", name: "Community Gathering", icon: "gathering", sortOrder: 50 },
  { slug: "other", name: "Other", icon: "other", sortOrder: 60 },
];

async function main() {
  const url = process.env.DATABASE_URL ?? "postgresql://jiwar:jiwar@localhost:55432/jiwar_dev";
  const sql = postgres(url);
  const db = drizzle(sql);

  for (const category of CATEGORIES) {
    await db.insert(categories).values(category).onConflictDoNothing({ target: categories.slug });
  }

  console.log(`Seeded ${CATEGORIES.length} categories.`);
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
