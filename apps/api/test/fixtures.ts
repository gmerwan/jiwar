import { eq } from "drizzle-orm";
import { categories, notices, participants } from "../src/db/schema.js";
import type { JiwarTestDb } from "./db-harness.js";
import { nanoid } from "nanoid";

// Central Algiers, used as the search origin throughout.
export const ALGIERS = { lat: 36.7538, lng: 3.0588 };

/** Offsets a point by a distance in metres along a bearing. */
export function offsetPoint(
  origin: { lat: number; lng: number },
  metres: number,
  bearingDegrees = 0,
): { lat: number; lng: number } {
  const R = 6_371_008.8;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(metres / R) + Math.cos(lat1) * Math.sin(metres / R) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(metres / R) * Math.cos(lat1),
      Math.cos(metres / R) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

export async function makeParticipant(db: JiwarTestDb): Promise<string> {
  const rows = await db.insert(participants).values({}).returning({ id: participants.id });
  const row = rows[0];
  if (!row) throw new Error("no participant created");
  return row.id;
}

export interface MakeNoticeOptions {
  lat?: number;
  lng?: number;
  startsAt?: Date;
  categorySlug?: string;
  title?: string;
  status?: "published" | "cancelled" | "removed";
  authorParticipantId?: string;
}

export async function makeNotice(db: JiwarTestDb, options: MakeNoticeOptions = {}) {
  const slug = options.categorySlug ?? "funeral";
  const category = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  if (!category[0]) throw new Error(`category ${slug} not seeded`);

  const authorParticipantId = options.authorParticipantId ?? (await makeParticipant(db));
  const publicId = nanoid(12);

  const rows = await db
    .insert(notices)
    .values({
      publicId,
      categoryId: category[0].id,
      title: options.title ?? "Test notice",
      description: "",
      venueName: "Test venue",
      address: "Test address",
      location: { lat: options.lat ?? ALGIERS.lat, lng: options.lng ?? ALGIERS.lng },
      startsAt: options.startsAt ?? new Date(Date.now() + 3 * 60 * 60 * 1000),
      attendance: "public",
      status: options.status ?? "published",
      authorParticipantId,
    })
    .returning();

  return rows[0]!;
}
