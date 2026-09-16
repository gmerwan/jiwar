import { Global, Module } from "@nestjs/common";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_CONFIG, type AppConfig, loadConfig } from "../config.js";
import { schema } from "./schema.js";

export const DRIZZLE = "DRIZZLE";
export type JiwarDb = PostgresJsDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    {
      provide: DRIZZLE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const sql = postgres(config.databaseUrl, { max: 10 });
        return drizzle(sql, { schema });
      },
    },
  ],
  exports: [DRIZZLE, APP_CONFIG],
})
export class DrizzleModule {}
