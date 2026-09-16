import { z } from "zod";

export const GeocodeResultSchema = z.object({
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
});

export type GeocodeResult = z.infer<typeof GeocodeResultSchema>;

export const GeocodeResultsSchema = z.object({
  results: z.array(GeocodeResultSchema),
});

export type GeocodeResults = z.infer<typeof GeocodeResultsSchema>;
