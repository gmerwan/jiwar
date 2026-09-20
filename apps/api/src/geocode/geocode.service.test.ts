import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeocodeResultSchema, GeocodeResultsSchema } from "@jiwar/contracts";
import { GeocodeService } from "./geocode.service.js";

const config = {
  nominatimBaseUrl: "https://nominatim.example.org",
  nominatimUserAgent: "jiwar-test/0.1",
} as never;

const nominatimResponse = [
  { display_name: "Masjid Al-Rahma, Algiers", lat: "36.7538", lon: "3.0588" },
  { display_name: "Algiers, Algeria", lat: "36.7762", lon: "3.0597" },
];

describe("GeocodeService", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: GeocodeService;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => nominatimResponse,
    });
    service = new GeocodeService(config, fetchMock as unknown as typeof fetch);
  });

  it("maps Nominatim results into the contract shape", async () => {
    const results = await service.search("masjid algiers");
    expect(results).toEqual([
      { label: "Masjid Al-Rahma, Algiers", lat: 36.7538, lng: 3.0588 },
      { label: "Algiers, Algeria", lat: 36.7762, lng: 3.0597 },
    ]);
  });

  it("sends the required identifying User-Agent", async () => {
    await service.search("algiers");
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("jiwar-test/0.1");
  });

  it("caches repeated identical queries instead of calling Nominatim again", async () => {
    await service.search("algiers");
    await service.search("algiers");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Carried instruction: check cache behaviour on a miss after TTL expiry, not
  // just the hit path the brief's own test covers.
  it("calls Nominatim again after the cache entry's TTL has expired", async () => {
    vi.useFakeTimers();
    try {
      await service.search("algiers");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Still within the 10-minute TTL: no second call.
      vi.advanceTimersByTime(9 * 60 * 1000);
      await service.search("algiers");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Past the 10-minute TTL: the entry expired, so this is a fresh fetch.
      vi.advanceTimersByTime(2 * 60 * 1000);
      await service.search("algiers");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns an empty list for a blank query without calling Nominatim", async () => {
    expect(await service.search("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty list when Nominatim fails, rather than throwing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    expect(await service.search("something")).toEqual([]);
  });

  it("reverse-geocodes a point into a label", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: "Algiers, Algeria", lat: "36.7538", lon: "3.0588" }),
    });
    const result = await service.reverse(36.7538, 3.0588);
    expect(result).toEqual({ label: "Algiers, Algeria", lat: 36.7538, lng: 3.0588 });
  });

  // Carried finding: the geocode schemas are load-bearing in production (Task 10's
  // client will call GeocodeResultsSchema.parse on every response) but nothing in
  // the plan runs the service's real output through them. These two tests do that
  // with a genuine runtime .parse/.safeParse, not a type annotation, so a drift
  // between the service's output shape and the contract schema fails loudly here
  // instead of at a user's browser.
  it("produces search results that satisfy GeocodeResultSchema and GeocodeResultsSchema", async () => {
    const results = await service.search("algiers");
    for (const result of results) {
      expect(GeocodeResultSchema.safeParse(result).success).toBe(true);
    }
    expect(GeocodeResultsSchema.safeParse({ results }).success).toBe(true);
  });

  it("produces a reverse-geocode result that satisfies GeocodeResultSchema", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: "Algiers, Algeria", lat: "36.7538", lon: "3.0588" }),
    });
    const result = await service.reverse(36.7538, 3.0588);
    expect(GeocodeResultSchema.safeParse(result).success).toBe(true);
  });
});
