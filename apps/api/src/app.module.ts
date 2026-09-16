import { Module } from "@nestjs/common";
import { DrizzleModule } from "./db/drizzle.module.js";

@Module({
  imports: [DrizzleModule],
})
export class AppModule {}
