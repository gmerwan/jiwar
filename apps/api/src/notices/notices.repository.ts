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
  /**
   * The `sort` this cursor was minted under, and the branch that minted it
   * ("upcoming" or the past-notice fallback). Both are needed because `k` is a bare
   * number in either mode — an epoch-millis key and a metres key are
   * indistinguishable once encoded — so without a discriminator a cursor from one
   * ordering is silently applied to another. `search` and `runSearch` each document
   * what they do on a mismatch, and why the two answers differ.
   */
  s: "soonest" | "nearest";
  w: "upcoming" | "past";
}

/**
 * Every character `nanoid` can emit, and nothing else.
 *
 * The tiebreaker `p` is compared against `notices.public_id`, which is a
 * `nanoid(12)` in a `varchar(16)`, so this is the complete set of legitimate
 * values. The bound is a hard security boundary rather than tidiness: a cursor is
 * an opaque client-supplied string that `SearchNoticesSchema` accepts unvalidated,
 * so before this check any JSON string reached postgres as a bound parameter.
 *
 * A NUL byte is the case that mattered. Postgres rejects NUL inside `text` at the
 * protocol level, so parameterisation does not help and the driver raises
 * `invalid byte sequence for encoding "UTF8": 0x00` — a 500 from an unauthenticated
 * query string once Task 8 exposes `?cursor=`, and a direct violation of the
 * "ignores a malformed cursor rather than throwing" invariant asserted below. The
 * length cap also bounds the payload: a 10 KB `p` was previously bound and sent.
 */
const CURSOR_TIEBREAKER_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Returns null for anything not minted by `encodeCursor`, so a bad cursor pages from the start. */
function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed?.k !== "number" || !Number.isFinite(parsed.k)) return null;
    if (typeof parsed?.p !== "string" || !CURSOR_TIEBREAKER_PATTERN.test(parsed.p)) return null;
    if (parsed?.s !== "soonest" && parsed?.s !== "nearest") return null;
    if (parsed?.w !== "upcoming" && parsed?.w !== "past") return null;
    return { k: parsed.k, p: parsed.p, s: parsed.s, w: parsed.w };
  } catch {
    return null;
  }
}

@Injectable()
export class NoticesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: JiwarDb) {}

  async search(params: SearchNotices, options: SearchOptions): Promise<SearchOutcome> {
    const cursor = decodeCursor(params.cursor);

    // A cursor minted by the past-notice fallback keeps paging the past branch for
    // the rest of the scroll, rather than letting `search()` re-decide per request.
    //
    // Re-deciding is what lost rows: the fallback is chosen by "is the upcoming
    // branch empty right now?", so publishing one upcoming notice mid-scroll flipped
    // page 2 to the upcoming branch and applied the *past* cursor key to it.
    // Measured before this fix, with six past notices and a `limit` of 2 —
    //   page 1: fallback=true  ["Old 1","Old 2"]
    //   (a notice starting in 3h is published)
    //   page 2: fallback=false ["NEW"] nextCursor=null
    // leaving "Old 3".."Old 6" unreachable. Spec §6 promises a notice published
    // mid-scroll "cannot cause a duplicate or a skipped row", so that was a spec
    // violation and not merely surprising.
    //
    // Pinning is chosen over ignoring the cursor because the alternative restarts the
    // reader at page 1 — every row they have already scrolled past comes back as a
    // duplicate, which is the other half of what §6 rules out. The reader keeps
    // descending through the past results they were actually looking at, and picks up
    // anything newly published on their next fresh search.
    if (cursor?.w === "past" && params.when === "upcoming") {
      const continued = await this.runSearch(params, options, "past", cursor);
      return { ...continued, fallback: true };
    }

    const primary = await this.runSearch(params, options, params.when, cursor);

    if (primary.items.length > 0 || params.when === "past") {
      return { ...primary, fallback: false };
    }

    // Spec §6: an empty upcoming search falls back to recent past notices. The
    // upcoming-minted cursor is deliberately not carried across the branch switch —
    // its key is measured against a different filter — so the fallback starts at its
    // own first page and mints a `w: "past"` cursor of its own.
    const fallback = await this.runSearch(params, options, "past", null);
    return { ...fallback, fallback: fallback.items.length > 0 };
  }

  private async runSearch(
    params: SearchNotices,
    options: SearchOptions,
    when: "upcoming" | "past",
    incoming: Cursor | null,
  ): Promise<{ items: NoticeWithDistance[]; nextCursor: string | null }> {
    const origin = sql`ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography`;
    const radiusMetres = params.radiusKm * 1000;
    const cutoff = sql`now() - make_interval(hours => ${options.pastGraceHours})`;
    const limit = params.limit;

    // A cursor minted under the other `sort` is discarded rather than applied. Its `k`
    // is a distance in metres where this query compares epoch millis, or the reverse:
    // both are plain numbers, so nothing downstream can detect the mismatch, and the
    // comparison silently succeeds against a meaningless bound. Measured before this
    // fix, toggling sort mid-scroll over five notices — carrying a `nearest` cursor
    // into a `soonest` query replayed `["N1","N2"]`, page 1 all over again, and
    // carrying a `soonest` cursor into a `nearest` query returned `[]`, a dead-end
    // page with rows still unread.
    //
    // Restarting is right here, unlike the fallback case above: changing the sort is a
    // deliberate act by the reader, and page 1 of the new ordering is what they asked
    // for. Re-serving rows under a *new* ordering is not the duplicate §6 forbids.
    const cursor = incoming && incoming.s === params.sort ? incoming : null;

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
      // The minted cursor records the ordering and the branch it came from, so the next
      // request can tell a continuation from a cursor belonging to a different query.
      nextCursor:
        hasMore && last
          ? encodeCursor({
              k: Number(last.sortKey),
              p: last.publicId,
              s: params.sort,
              w: when,
            })
          : null,
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
