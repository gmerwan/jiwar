import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Category } from "@jiwar/contracts";
import { CategoriesService } from "./categories.service.js";

@ApiTags("categories")
@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOkResponse({ description: "Active notice categories, in display order." })
  list(): Promise<Category[]> {
    return this.categories.list();
  }
}
