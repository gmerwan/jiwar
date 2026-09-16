import { z } from "zod";
import { LatitudeSchema, LongitudeSchema, NoticeSchema } from "./notice.js";

export const MAX_RADIUS_KM_HARD_LIMIT = 500;
export const DEFAULT_RADIUS_KM = 20;

const CategoryListSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .optional();

export const SearchNoticesSchema = z.object({
  lat: LatitudeSchema,
  lng: LongitudeSchema,
  radiusKm: z.coerce.number().positive().max(MAX_RADIUS_KM_HARD_LIMIT).default(DEFAULT_RADIUS_KM),
  categories: CategoryListSchema,
  when: z.enum(["upcoming", "past"]).default("upcoming"),
  sort: z.enum(["soonest", "nearest"]).default("soonest"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type SearchNotices = z.infer<typeof SearchNoticesSchema>;

export const NoticeWithDistanceSchema = NoticeSchema.extend({
  distanceMetres: z.number(),
});

export type NoticeWithDistance = z.infer<typeof NoticeWithDistanceSchema>;

export const NoticeSearchResultSchema = z.object({
  items: z.array(NoticeWithDistanceSchema),
  nextCursor: z.string().nullable(),
  fallback: z.boolean(),
});

export type NoticeSearchResult = z.infer<typeof NoticeSearchResultSchema>;
