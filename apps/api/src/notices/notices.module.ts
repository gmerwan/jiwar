import { Module } from "@nestjs/common";
import { NoticesController } from "./notices.controller.js";
import { NoticesRepository } from "./notices.repository.js";
import { NoticesService } from "./notices.service.js";

@Module({
  controllers: [NoticesController],
  providers: [NoticesService, NoticesRepository],
  exports: [NoticesService],
})
export class NoticesModule {}
