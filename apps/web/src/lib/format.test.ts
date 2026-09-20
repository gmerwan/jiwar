import { describe, expect, it } from "vitest";
import { formatDateTime, formatDistance } from "./format.js";

describe("formatDistance", () => {
  it("shows metres below one kilometre", () => {
    expect(formatDistance(450)).toBe("450 m");
  });

  it("shows one decimal between 1 and 10 km", () => {
    expect(formatDistance(2_400)).toBe("2.4 km");
  });

  it("rounds to whole kilometres above 10 km", () => {
    expect(formatDistance(15_600)).toBe("16 km");
  });

  it("handles zero", () => {
    expect(formatDistance(0)).toBe("0 m");
  });
});

describe("formatDateTime", () => {
  it("formats an ISO datetime via Intl without throwing", () => {
    const output = formatDateTime("2026-10-01T12:30:00.000Z");
    expect(output).toMatch(/2026/);
    expect(output.length).toBeGreaterThan(6);
  });
});
