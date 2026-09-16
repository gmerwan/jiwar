import { describe, expect, it } from "vitest";
import { CreateNoticeSchema } from "./notice.js";

const valid = {
  categorySlug: "funeral",
  title: "Funeral prayer for the late Ahmed Benali",
  description: "Prayer will be held after Dhuhr.",
  venueName: "Masjid Al-Rahma",
  address: "Rue Didouche Mourad, Algiers",
  lat: 36.75,
  lng: 3.06,
  startsAt: "2026-10-01T12:30:00.000Z",
  attendance: "public" as const,
};

describe("CreateNoticeSchema", () => {
  it("accepts a valid notice", () => {
    expect(CreateNoticeSchema.parse(valid).title).toBe(valid.title);
  });

  it("trims the title and rejects one that is blank or too short", () => {
    expect(CreateNoticeSchema.parse({ ...valid, title: "  Hello there  " }).title).toBe("Hello there");
    expect(() => CreateNoticeSchema.parse({ ...valid, title: "   " })).toThrow();
    expect(() => CreateNoticeSchema.parse({ ...valid, title: "ab" })).toThrow();
  });

  it("rejects an invalid attendance value", () => {
    expect(() => CreateNoticeSchema.parse({ ...valid, attendance: "maybe" })).toThrow();
  });

  it("requires organizerConsent when organizerContact is given", () => {
    expect(() =>
      CreateNoticeSchema.parse({ ...valid, organizerContact: "+213 555 0000", organizerConsent: false }),
    ).toThrow(/consent/i);

    const ok = CreateNoticeSchema.parse({
      ...valid,
      organizerContact: "+213 555 0000",
      organizerConsent: true,
    });
    expect(ok.organizerContact).toBe("+213 555 0000");
  });

  it("does not require consent when no organizer contact is given", () => {
    expect(() => CreateNoticeSchema.parse({ ...valid, organizerConsent: false })).not.toThrow();
  });
});
