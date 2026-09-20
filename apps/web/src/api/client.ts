import {
  CategorySchema,
  GeocodeResultsSchema,
  NoticeSchema,
  NoticeSearchResultSchema,
  type Category,
  type CreateNotice,
  type GeocodeResult,
  type Notice,
  type NoticeSearchResult,
} from "@jiwar/contracts";
import { z } from "zod";

export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SearchParams {
  lat: number;
  lng: number;
  radiusKm: number;
  categories?: string[];
  when?: "upcoming" | "past";
  sort?: "soonest" | "nearest";
  cursor?: string;
}

const CategoriesSchema = z.array(CategorySchema);
const CreatedSchema = z.object({ publicId: z.string() });
const CancelledSchema = z.object({ cancelled: z.literal(true) });
const ReverseSchema = z.object({
  result: z.object({ label: z.string(), lat: z.number(), lng: z.number() }).nullable(),
});

export function createApiClient(fetchImpl: typeof fetch = fetch) {
  async function call<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetchImpl(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        (body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : null) ?? `Request failed with status ${response.status}`;
      throw new ApiError(response.status, message);
    }

    return schema.parse(body);
  }

  function searchQuery(params: SearchParams): string {
    const query = new URLSearchParams();
    query.set("lat", String(params.lat));
    query.set("lng", String(params.lng));
    query.set("radiusKm", String(params.radiusKm));
    if (params.when) query.set("when", params.when);
    if (params.sort) query.set("sort", params.sort);
    if (params.cursor) query.set("cursor", params.cursor);
    for (const category of params.categories ?? []) query.append("categories", category);
    return query.toString();
  }

  return {
    categories: (): Promise<Category[]> => call("/v1/categories", CategoriesSchema),

    searchNotices: (params: SearchParams): Promise<NoticeSearchResult> =>
      call(`/v1/notices?${searchQuery(params)}`, NoticeSearchResultSchema),

    getNotice: (publicId: string): Promise<Notice> =>
      call(`/v1/notices/${encodeURIComponent(publicId)}`, NoticeSchema),

    createNotice: (body: CreateNotice): Promise<{ publicId: string }> =>
      call("/v1/notices", CreatedSchema, { method: "POST", body: JSON.stringify(body) }),

    cancelNotice: (publicId: string): Promise<{ cancelled: true }> =>
      call(`/v1/notices/${encodeURIComponent(publicId)}/cancel`, CancelledSchema, {
        method: "POST",
      }),

    geocode: async (q: string): Promise<GeocodeResult[]> =>
      (await call(`/v1/geocode?q=${encodeURIComponent(q)}`, GeocodeResultsSchema)).results,

    reverseGeocode: async (lat: number, lng: number): Promise<GeocodeResult | null> =>
      (await call(`/v1/reverse-geocode?lat=${lat}&lng=${lng}`, ReverseSchema)).result,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
export const api = createApiClient();
