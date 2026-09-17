import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { ParticipantMiddleware } from "./participant.middleware.js";
import { ParticipantsService } from "./participants.service.js";

@Module({
  providers: [ParticipantsService, ParticipantMiddleware],
  exports: [ParticipantsService],
})
export class ParticipantsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ParticipantMiddleware).forRoutes("*");
  }
}
