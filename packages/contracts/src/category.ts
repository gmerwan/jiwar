import { z } from "zod";

export const CategorySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().min(1),
  sortOrder: z.number().int(),
});

export type Category = z.infer<typeof CategorySchema>;
