import { Inject, Injectable } from "@nestjs/common";
import type { Notice, NoticeWithDistance, SearchNotices } from "@jiwar/contracts";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { DRIZZLE, type JiwarDb } from "../db/drizzle.module.js";
import { categories, notices } from "../db/schema.js";
import { toNotice, toNoticeWithDistance, type NoticeRow } from "./notices.mapper.js";

export interface SearchOptions {
  pastGraceHours: number;
}

export interface SearchOutcome {
  items: NoticeWithDistance[];
  nextCursor: string | null;
  fallback: boolean;
}

export interface InsertNoticeInput {
  categorySlug: string;
  title: string;
  description: string;
  venueName: string;
  address: string;
  lat: number;
  lng: number;
  startsAt: Date;
  attendance: "public" | "invitation_only" | "restricted";
  organizerName?: string;
  organizerContact?: string;
  authorParticipantId: string;
}

interface Cursor {
  /** Sort key of the last row: epoch millis for soonest, metres for nearest. */
  k: number;
  /** publicId tiebreaker, so equal keys still page deterministically. */
  p: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed?.k === "number" && typeof parsed?.p === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

@Injectable()
export class NoticesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: JiwarDb) {}

  async search(params: SearchNotices, options: SearchOptions): Promise<SearchOutcome> {
    const primary = await this.runSearch(params, options, params.when);

    if (primary.items.length > 0 || params.when === "past") {
      return { ...primary, fallback: false };
    }

    // Spec §6: an empty upcoming search falls back to recent past notices.
    const fallback = await this.runSearch(params, options, "past");
    return { ...fallback, fallback: fallback.items.length > 0 };
  }

  private async runSearch(
    params: SearchNotices,
    options: SearchOptions,
    when: "upcoming" | "past",
  ): Promise<{ items: NoticeWithDistance[]; nextCursor: string | null }> {
    const origin = sql`ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography`;
    const radiusMetres = params.radiusKm * 1000;
    const cutoff = sql`now() - make_interval(hours => ${options.pastGraceHours})`;
    const cursor = decodeCursor(params.cursor);
    const limit = params.limit;

    const conditions = [
      sql`n.status = 'published'`,
      sql`ST_DWithin(n.location, ${origin}, ${radiusMetres})`,
      when === "upcoming" ? sql`n.starts_at >= ${cutoff}` : sql`n.starts_at < ${cutoff}`,
    ];

    if (params.categories && params.categories.length > 0) {
      // `sql.param(...)` is load-bearing, and the brief's bare `ANY(${params.categories})`
      // does not work here. Drizzle's `sql` tagged template treats a raw JS array as a
      // *list* to expand, not as one value: `sql.js` wraps it in parentheses and emits one
      // placeholder per element (see `buildQueryFromSourceParams`, the `Array.isArray(chunk)`
      // branch). So `ANY(${["wedding"]})` renders `ANY(($7))` with `$7` bound as text, and
      // Postgres rejects it — measured: `22P02 malformed array literal: "wedding"`,
      // `Array value must start with "{"`.
      //
      // `sql.param(...)` wraps the array as a single bound parameter instead, which
      // postgres-js sends as a real text[] (OID 1009) — the one operand `= ANY(...)`
      // accepts. Verified against one and two slugs.
      //
      // `c.slug IN ${params.categories}` also works, via that same list expansion, but it
      // recompiles for every distinct filter length; one array parameter keeps the
      // statement shape stable no matter how many categories the caller ticks.
      conditions.push(sql`c.slug = ANY(${sql.param(params.categories)})`);
    }

    // Ordering differs per sort, and the cursor compares against the same key.
    const isNearest = params.sort === "nearest";
    const sortKey = isNearest
      ? sql`ST_Distance(n.location, ${origin})`
      : sql`extract(epoch from n.starts_at) * 1000`;
    // "past" reads best newest-first; upcoming reads soonest-first.
    const direction = !isNearest && when === "past" ? sql`desc` : sql`asc`;

    if (cursor) {
      const descending = !isNearest && when === "past";
      conditions.push(
        descending
          ? sql`(${sortKey}, n.public_id) < (${cursor.k}, ${cursor.p})`
          : sql`(${sortKey}, n.public_id) > (${cursor.k}, ${cursor.p})`,
      );
    }

    const whereClause = conditions.reduce((acc, condition, index) =>
      index === 0 ? condition : sql`${acc} AND ${condition}`,
    );

    const rows = await this.db.execute<NoticeRow & { sortKey: number }>(sql`
      SELECT
        n.public_id            AS "publicId",
        n.title               AS "title",
        n.description         AS "description",
        n.venue_name          AS "venueName",
        n.address             AS "address",
        ST_Y(n.location::geometry) AS "lat",
        ST_X(n.location::geometry) AS "lng",
        n.starts_at           AS "startsAt",
        n.attendance          AS "attendance",
        n.organizer_name      AS "organizerName",
        n.organizer_contact   AS "organizerContact",
        n.status              AS "status",
        n.created_at          AS "createdAt",
        c.slug                AS "categorySlug",
        c.name                AS "categoryName",
        c.icon                AS "categoryIcon",
        c.sort_order          AS "categorySortOrder",
        ST_Distance(n.location, ${origin}) AS "distanceMetres",
        ${sortKey}            AS "sortKey"
      FROM notices n
      JOIN categories c ON c.id = n.category_id
      WHERE ${whereClause}
      ORDER BY ${sortKey} ${direction}, n.public_id ${direction}
      LIMIT ${limit + 1}
    `);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => toNoticeWithDistance(row, options.pastGraceHours)),
      nextCursor:
        hasMore && last ? encodeCursor({ k: Number(last.sortKey), p: last.publicId }) : null,
    };
  }

  async insert(input: InsertNoticeInput): Promise<string> {
    const category = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.slug, input.categorySlug), eq(categories.active, true)))
      .limit(1);

    if (!category[0]) throw new Error(`Unknown category: ${input.categorySlug}`);

    const publicId = nanoid(12);

    await this.db.insert(notices).values({
      publicId,
      categoryId: category[0].id,
      title: input.title,
      description: input.description,
      venueName: input.venueName,
      address: input.address,
      location: { lat: input.lat, lng: input.lng },
      startsAt: input.startsAt,
      attendance: input.attendance,
      organizerName: input.organizerName ?? null,
      organizerContact: input.organizerContact ?? null,
      authorParticipantId: input.authorParticipantId,
    });

    return publicId;
  }

  async findByPublicId(publicId: string, pastGraceHours = 24): Promise<Notice | null> {
    const rows = await this.db.execute<NoticeRow>(sql`
      SELECT
        n.public_id            AS "publicId",
        n.title               AS "title",
        n.description         AS "description",
        n.venue_name          AS "venueName",
        n.address             AS "address",
        ST_Y(n.location::geometry) AS "lat",
        ST_X(n.location::geometry) AS "lng",
        n.starts_at           AS "startsAt",
        n.attendance          AS "attendance",
        n.organizer_name      AS "organizerName",
        n.organizer_contact   AS "organizerContact",
        n.status              AS "status",
        n.created_at          AS "createdAt",
        c.slug                AS "categorySlug",
        c.name                AS "categoryName",
        c.icon                AS "categoryIcon",
        c.sort_order          AS "categorySortOrder"
      FROM notices n
      JOIN categories c ON c.id = n.category_id
      WHERE n.public_id = ${publicId} AND n.status <> 'removed'
      LIMIT 1
    `);

    const row = rows[0];
    return row ? toNotice(row, pastGraceHours) : null;
  }

  /** Returns false when the notice does not exist or the participant is not its author. */
  async cancel(publicId: string, participantId: string): Promise<boolean> {
    const updated = await this.db
      .update(notices)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(notices.publicId, publicId),
          eq(notices.authorParticipantId, participantId),
          eq(notices.status, "published"),
        ),
      )
      .returning({ publicId: notices.publicId });

    return updated.length > 0;
  }
}
