import { Inject, Injectable, Logger } from "@nestjs/common";
import type { GeocodeResult } from "@jiwar/contracts";
import { APP_CONFIG, type AppConfig } from "../config.js";

interface NominatimPlace {
  display_name?: string;
  lat?: string;
  lon?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);
  private readonly cache = new Map<string, { at: number; value: GeocodeResult[] }>();

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

    const url = new URL("/search", this.config.nominatimBaseUrl);
    url.searchParams.set("q", trimmed);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "8");
    url.searchParams.set("addressdetails", "0");

    const places = await this.request<NominatimPlace[]>(url);
    const results = (places ?? []).flatMap((place) => this.toResult(place) ?? []);
    this.writeCache(cacheKey, results);
    return results;
  }

  async reverse(lat: number, lng: number): Promise<GeocodeResult | null> {
    const cacheKey = `r:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = this.readCache(cacheKey);
    if (cached) return cached[0] ?? null;

    const url = new URL("/reverse", this.config.nominatimBaseUrl);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "json");

    const place = await this.request<NominatimPlace>(url);
    const result = place ? this.toResult(place) : null;
    this.writeCache(cacheKey, result ? [result] : []);
    return result;
  }

  private toResult(place: NominatimPlace): GeocodeResult | null {
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    if (!place.display_name || Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { label: place.display_name, lat, lng };
  }

  private async request<T>(url: URL): Promise<T | null> {
    try {
      const response = await this.fetchImpl(url.toString(), {
        headers: {
          "User-Agent": this.config.nominatimUserAgent,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        this.logger.warn(`Nominatim returned ${response.status} for ${url.pathname}`);
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn(`Nominatim request failed: ${String(error)}`);
      return null;
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
