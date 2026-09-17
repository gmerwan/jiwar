import { Module } from "@nestjs/common";
import { DrizzleModule } from "./db/drizzle.module.js";
import { ParticipantsModule } from "./participants/participants.module.js";

@Module({
  imports: [DrizzleModule, ParticipantsModule],
})
export class AppModule {}
