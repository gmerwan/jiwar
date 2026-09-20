import { Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { GeocodeController } from "./geocode.controller.js";
import { GeocodeService } from "./geocode.service.js";

@Module({
  controllers: [GeocodeController],
  providers: [
    {
      provide: GeocodeService,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new GeocodeService(config),
    },
  ],
  exports: [GeocodeService],
})
export class GeocodeModule {}
