import { Inject, Injectable } from "@nestjs/common";
import type { Category } from "@jiwar/contracts";
import { asc, eq } from "drizzle-orm";
import { DRIZZLE, type JiwarDb } from "../db/drizzle.module.js";
import { categories } from "../db/schema.js";

@Injectable()
export class CategoriesService {
  constructor(@Inject(DRIZZLE) private readonly db: JiwarDb) {}

  async list(): Promise<Category[]> {
    const rows = await this.db
      .select({
        slug: categories.slug,
        name: categories.name,
        icon: categories.icon,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .where(eq(categories.active, true))
      .orderBy(asc(categories.sortOrder));

    return rows;
  }
}
