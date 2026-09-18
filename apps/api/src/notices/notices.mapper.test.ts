import { describe, expect, it } from "vitest";
import { toNotice, toNoticeWithDistance, type NoticeRow } from "./notices.mapper.js";

/**
 * These cases exist because of a real failure, not for coverage.
 *
 * The task brief typed `NoticeRow.startsAt` as `Date`, which is what Drizzle's
 * query builder returns. The repository reads through raw `db.execute()` instead,
 * and that path returns timestamps as **strings** — Drizzle installs identity
 * parsers over postgres-js's date decoders (`postgres-js/driver.js`), and raw SQL
 * carries no column metadata to reapply one. Every search and detail case failed
 * with `TypeError: row.startsAt.toISOString is not a function` until the mapper
 * normalised both shapes. A unit test is the cheap place to keep that fixed.
 */

const BASE: NoticeRow = {
  publicId: "abc123def456",
  title: "A funeral",
  description: "",
  venueName: "Mosque",
  address: "Algiers",
  lat: 36.7538,
  lng: 3.0588,
  // The exact wire format postgres sends for `timestamptz`: space-separated, and a
  // zone offset with no minutes. Not ISO 8601.
  startsAt: "2026-09-18 21:51:01.237+00",
  attendance: "public",
  organizerName: null,
  organizerContact: null,
  status: "published",
  createdAt: "2026-09-18 18:51:01.240416+00",
  categorySlug: "funeral",
  categoryName: "Funeral",
  categoryIcon: "funeral",
  categorySortOrder: 10,
};

describe("notice mappers", () => {
  it("accepts the string timestamps raw SQL returns and emits ISO 8601", () => {
    const notice = toNotice(BASE, 24);
    expect(notice.startsAt).toBe("2026-09-18T21:51:01.237Z");
    // Postgres sends microseconds; JS Date holds milliseconds, so this truncates
    // rather than rounds. Asserted so the loss is a known quantity, not a surprise.
    expect(notice.createdAt).toBe("2026-09-18T18:51:01.240Z");
  });

  it("accepts a real Date too, so the query-builder path keeps working", () => {
    const notice = toNotice(
      { ...BASE, startsAt: new Date("2026-09-18T21:51:01.237Z"), createdAt: new Date(0) },
      24,
    );
    expect(notice.startsAt).toBe("2026-09-18T21:51:01.237Z");
    expect(notice.createdAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("throws on an unparseable timestamp instead of yielding an Invalid Date", () => {
    // Returning `null`/`"Invalid Date"` here would surface as a corrupt API
    // response far from the cause, so the mapper fails loudly at the boundary.
    expect(() => toNotice({ ...BASE, startsAt: "not a timestamp" }, 24)).toThrow(
      /Unparseable timestamp/,
    );
  });

  it("applies the grace window to isPast on both sides of the boundary", () => {
    const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
    const hour = 60 * 60 * 1000;

    // 23h ago with a 24h grace: still counts as upcoming.
    expect(toNotice({ ...BASE, startsAt: iso(-23 * hour) }, 24).isPast).toBe(false);
    // 25h ago with the same grace: past.
    expect(toNotice({ ...BASE, startsAt: iso(-25 * hour) }, 24).isPast).toBe(true);
    // The same instant is upcoming or past purely by the configured grace, which
    // is what makes `pastGraceHours` worth passing through rather than hardcoding.
    expect(toNotice({ ...BASE, startsAt: iso(-25 * hour) }, 48).isPast).toBe(false);
  });

  it("rounds the distance to whole metres and defaults a missing one to zero", () => {
    expect(toNoticeWithDistance({ ...BASE, distanceMetres: 4882.45937586 }, 24).distanceMetres).toBe(
      4882,
    );
    expect(toNoticeWithDistance({ ...BASE, distanceMetres: 4990.6 }, 24).distanceMetres).toBe(4991);
    expect(toNoticeWithDistance(BASE, 24).distanceMetres).toBe(0);
  });

  it("carries the joined category through as a nested object", () => {
    expect(toNoticeWithDistance({ ...BASE, distanceMetres: 1 }, 24).category).toEqual({
      slug: "funeral",
      name: "Funeral",
      icon: "funeral",
      sortOrder: 10,
    });
  });
});
