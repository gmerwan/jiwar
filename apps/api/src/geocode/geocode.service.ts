import { Inject, Injectable, Logger } from "@nestjs/common";
import type { GeocodeResult } from "@jiwar/contracts";
import { z } from "zod";
import { APP_CONFIG, type AppConfig } from "../config.js";

// Minimal shape check on the upstream body, not a full Nominatim schema — we
// only read these three fields, and everything else on the wire is passed
// through untouched. Extra/unknown fields are ignored (z.object's default),
// matching the leniency we want here: strict enough to reject "not shaped
// like a place at all" (an object where an array was expected, a null entry,
// a completely different payload), lenient enough not to break on a Nominatim
// response field we don't otherwise use.
const NominatimPlaceSchema = z.object({
  display_name: z.string().optional(),
  lat: z.string().optional(),
  lon: z.string().optional(),
});
const NominatimPlacesSchema = z.array(NominatimPlaceSchema);

type NominatimPlace = z.infer<typeof NominatimPlaceSchema>;

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

// A few seconds is generous enough for a normal Nominatim round trip (typically
// well under 1s) but short enough that a degraded upstream can't leave requests
// piling up indefinitely — which matters doubly once concurrent identical
// requests are coalesced onto a single in-flight promise (see `inFlight` below):
// without a bound, one stuck request would stall every waiter behind it.
const REQUEST_TIMEOUT_MS = 5000;

@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);
  private readonly cache = new Map<string, { at: number; value: GeocodeResult[] }>();

  // Coalesces concurrent identical requests. The cache above only helps once a
  // result has already been written, so back-to-back sequential calls hit it —
  // but N *simultaneous* callers for the same key (typeahead keystrokes, a
  // React StrictMode double-invoke, a client retry) would all miss the cache
  // and all reach Nominatim at once, which is exactly the burst its ~1 req/s
  // limit can't absorb. Entries here are removed as soon as the in-flight
  // request settles (success or failure), so a transient miss never poisons
  // the key for future callers the way a longer-lived cache entry might.
  private readonly inFlight = new Map<string, Promise<GeocodeResult[]>>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string): Promise<GeocodeResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const cacheKey = `s:${trimmed.toLowerCase()}`;
    const cached = this.readCache(cacheKey);
    if (cached) return cached;

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const url = new URL("/search", this.config.nominatimBaseUrl);
    url.searchParams.set("q", trimmed);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "8");
    url.searchParams.set("addressdetails", "0");

    const pending = this.request(url, NominatimPlacesSchema)
      .then((places) => {
        const results = (places ?? []).flatMap((place) => this.toResult(place) ?? []);
        this.writeCache(cacheKey, results);
        return results;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });
    this.inFlight.set(cacheKey, pending);
    return pending;
  }

  async reverse(lat: number, lng: number): Promise<GeocodeResult | null> {
    const cacheKey = `r:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = this.readCache(cacheKey);
    if (cached) return cached[0] ?? null;

    const existing = this.inFlight.get(cacheKey);
    if (existing) return (await existing)[0] ?? null;

    const url = new URL("/reverse", this.config.nominatimBaseUrl);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "json");

    const pending = this.request(url, NominatimPlaceSchema)
      .then((place) => {
        const result = place ? this.toResult(place) : null;
        this.writeCache(cacheKey, result ? [result] : []);
        return result ? [result] : [];
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });
    this.inFlight.set(cacheKey, pending);
    const results = await pending;
    return results[0] ?? null;
  }

  private toResult(place: NominatimPlace): GeocodeResult | null {
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    if (!place.display_name || Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { label: place.display_name, lat, lng };
  }

  private async request<S extends z.ZodType>(
    url: URL,
    schema: S,
  ): Promise<z.infer<S> | null> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fetchPromise = this.fetchImpl(url.toString(), {
      headers: {
        "User-Agent": this.config.nominatimUserAgent,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    // If the timeout below wins the race, this promise is abandoned by the code
    // that follows but keeps running in the background — with a real fetch it
    // eventually rejects with an AbortError once controller.abort() fires below.
    // Without this no-op handler, that later rejection is unobserved and Node
    // reports it as an unhandled rejection.
    fetchPromise.catch(() => undefined);

    // A race, not just an AbortSignal, is what actually bounds this call: a
    // signal only helps if whatever produced the fetch promise is listening to
    // it. Racing against a timer means `request()` settles on the timeout
    // regardless of whether the underlying fetch (real or, in a test, a stub)
    // ever notices the abort — which matters doubly now that identical
    // concurrent callers share this same pending promise (see `inFlight`
    // above): one stuck request must not stall every waiter behind it forever.
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(`Nominatim request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
    });

    try {
      const response = await Promise.race([fetchPromise, timeoutPromise]);
      if (!response.ok) {
        this.logger.warn(`Nominatim returned ${response.status} for ${url.pathname}`);
        return null;
      }
      const body: unknown = await response.json();
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        this.logger.warn(`Nominatim response for ${url.pathname} did not match the expected shape`);
        return null;
      }
      return parsed.data;
    } catch (error) {
      if (timedOut) {
        this.logger.warn(`Nominatim request timed out after ${REQUEST_TIMEOUT_MS}ms for ${url.pathname}`);
      } else {
        this.logger.warn(`Nominatim request failed: ${String(error)}`);
      }
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private readCache(key: string): GeocodeResult[] | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return hit.value;
  }

  private writeCache(key: string, value: GeocodeResult[]): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), value });
  }
}
