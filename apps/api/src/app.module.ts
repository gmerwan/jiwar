import { Module } from "@nestjs/common";
import { CategoriesModule } from "./categories/categories.module.js";
import { DrizzleModule } from "./db/drizzle.module.js";
import { NoticesModule } from "./notices/notices.module.js";
import { ParticipantsModule } from "./participants/participants.module.js";

@Module({
  imports: [DrizzleModule, ParticipantsModule, CategoriesModule, NoticesModule],
})
export class AppModule {}
