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

  // --- Review round 1, Fix 1: concurrent identical requests are coalesced ---

  describe("concurrency", () => {
    it("coalesces N concurrent identical searches into a single upstream fetch", async () => {
      // A deferred fetch so all five callers are genuinely in flight at once,
      // rather than each call finishing before the next starts.
      let resolveFetch!: (value: unknown) => void;
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );

      const calls = [
        service.search("algiers"),
        service.search("algiers"),
        service.search("algiers"),
        service.search("algiers"),
        service.search("algiers"),
      ];

      resolveFetch({ ok: true, json: async () => nominatimResponse });
      const results = await Promise.all(calls);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      for (const result of results) {
        expect(result).toEqual([
          { label: "Masjid Al-Rahma, Algiers", lat: 36.7538, lng: 3.0588 },
          { label: "Algiers, Algeria", lat: 36.7762, lng: 3.0597 },
        ]);
      }
    });

    it("still makes one upstream fetch per query for sequential (non-overlapping) calls", async () => {
      await service.search("algiers");
      await service.search("algiers");
      await service.search("algiers");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not coalesce concurrent searches for different queries", async () => {
      let resolveFirst!: (value: unknown) => void;
      let resolveSecond!: (value: unknown) => void;
      let callIndex = 0;
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            callIndex += 1;
            if (callIndex === 1) resolveFirst = resolve;
            else resolveSecond = resolve;
          }),
      );

      const first = service.search("algiers");
      const second = service.search("oran");

      resolveFirst({ ok: true, json: async () => nominatimResponse });
      resolveSecond({ ok: true, json: async () => nominatimResponse });
      await Promise.all([first, second]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("propagates a failure to every waiter without an unhandled rejection", async () => {
      let rejectFetch!: (error: unknown) => void;
      fetchMock.mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectFetch = reject;
          }),
      );

      const calls = [service.search("algiers"), service.search("algiers"), service.search("algiers")];
      rejectFetch(new Error("network down"));
      const results = await Promise.all(calls);

      // request() catches network errors and degrades to null/empty rather than
      // throwing, so every waiter on the shared in-flight promise gets the same
      // graceful empty result — none of them sees an unhandled rejection, and
      // only one upstream call was made for all three waiters.
      expect(results).toEqual([[], [], []]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("removes the in-flight entry once the shared request settles, successfully or not", async () => {
      // Distinct keys per phase so this observes the in-flight map's own
      // lifecycle rather than the (separate, deliberately unchanged this round)
      // negative-caching behaviour: a failed search's *cache* entry legitimately
      // holds [] for the rest of the TTL, but the in-flight *coalescing* entry
      // for that key must still be gone once the request settles, or a second
      // concurrent burst for the same key later would wait on a stale promise
      // instead of deciding fresh whether to use the (now time-limited) cache.
      let rejectFetch!: (error: unknown) => void;
      fetchMock.mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectFetch = reject;
          }),
      );
      const firstBurst = [service.search("failure-key"), service.search("failure-key")];
      rejectFetch(new Error("network down"));
      await Promise.all(firstBurst);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // A second, later concurrent burst for a *different* key must still
      // coalesce to exactly one more upstream call — proving the in-flight map
      // isn't left holding a dangling/rejected entry that corrupts later keys.
      let resolveFetch!: (value: unknown) => void;
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const secondBurst = [service.search("another-key"), service.search("another-key")];
      resolveFetch({ ok: true, json: async () => nominatimResponse });
      await Promise.all(secondBurst);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("coalesces N concurrent identical reverse-geocode calls into a single upstream fetch", async () => {
      let resolveFetch!: (value: unknown) => void;
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );

      const calls = [
        service.reverse(36.7538, 3.0588),
        service.reverse(36.7538, 3.0588),
        service.reverse(36.7538, 3.0588),
      ];

      resolveFetch({
        ok: true,
        json: async () => ({ display_name: "Algiers, Algeria", lat: "36.7538", lon: "3.0588" }),
      });
      const results = await Promise.all(calls);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      for (const result of results) {
        expect(result).toEqual({ label: "Algiers, Algeria", lat: 36.7538, lng: 3.0588 });
      }
    });
  });

  // --- Review round 1, Fix 2: outbound fetch is bounded by a timeout ---

  describe("timeout", () => {
    it("settles with an empty list, rather than hanging, when fetch never resolves", async () => {
      vi.useFakeTimers();
      try {
        // A fetch that never settles at all — no ok, no rejection, nothing.
        // Without a timeout race, `search()` would hang forever on this.
        fetchMock.mockImplementation(() => new Promise(() => {}));

        const call = service.search("algiers");
        // Advance past REQUEST_TIMEOUT_MS (5s) so the timeout race wins.
        await vi.advanceTimersByTimeAsync(6000);

        await expect(call).resolves.toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("settles reverse() with null, rather than hanging, when fetch never resolves", async () => {
      vi.useFakeTimers();
      try {
        fetchMock.mockImplementation(() => new Promise(() => {}));

        const call = service.reverse(36.7538, 3.0588);
        await vi.advanceTimersByTimeAsync(6000);

        await expect(call).resolves.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("aborts the underlying fetch's signal when the timeout fires", async () => {
      vi.useFakeTimers();
      try {
        let capturedSignal: AbortSignal | undefined;
        fetchMock.mockImplementation((_url: string, init: RequestInit) => {
          capturedSignal = init.signal as AbortSignal;
          return new Promise(() => {});
        });

        const call = service.search("algiers");
        await vi.advanceTimersByTimeAsync(6000);
        await call;

        expect(capturedSignal?.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // --- Review round 1, Fix 3: a 200 OK in an unexpected shape degrades gracefully ---

  describe("malformed upstream shape", () => {
    it("returns an empty list when /search's 200 OK body is an object instead of an array", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ display_name: "not an array" }),
      });
      expect(await service.search("algiers")).toEqual([]);
    });

    it("returns an empty list when the search results array contains a null entry", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => [
          { display_name: "Algiers, Algeria", lat: "36.7538", lon: "3.0588" },
          null,
        ],
      });
      expect(await service.search("algiers")).toEqual([]);
    });

    it("returns null when reverse's 200 OK body is an array instead of an object", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => [{ display_name: "Algiers, Algeria", lat: "36.7538", lon: "3.0588" }],
      });
      expect(await service.reverse(36.7538, 3.0588)).toBeNull();
    });

    it("returns null when reverse's 200 OK body is null", async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => null });
      expect(await service.reverse(36.7538, 3.0588)).toBeNull();
    });
  });
});
