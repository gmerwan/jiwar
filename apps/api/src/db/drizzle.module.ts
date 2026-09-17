import { Global, Module, type OnModuleDestroy, Inject } from "@nestjs/common";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_CONFIG, type AppConfig, loadConfig } from "../config.js";
import { schema } from "./schema.js";

export const DRIZZLE = "DRIZZLE";

/**
 * The raw postgres-js connection pool. It is a provider in its own right rather
 * than a local inside the DRIZZLE factory, because a Drizzle instance exposes no
 * way to close the pool it wraps. Without a handle on the pool, `app.close()`
 * leaves TCP sockets and their timers open, so the Node process never becomes
 * idle and a test run hangs after the last assertion.
 */
export const POSTGRES_CLIENT = "POSTGRES_CLIENT";

export type JiwarDb = PostgresJsDatabase<typeof schema>;
export type PostgresClient = ReturnType<typeof postgres>;

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    {
      provide: POSTGRES_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => postgres(config.databaseUrl, { max: 10 }),
    },
    {
      provide: DRIZZLE,
      inject: [POSTGRES_CLIENT],
      useFactory: (client: PostgresClient) => drizzle(client, { schema }),
    },
  ],
  exports: [DRIZZLE, POSTGRES_CLIENT, APP_CONFIG],
})
export class DrizzleModule implements OnModuleDestroy {
  constructor(@Inject(POSTGRES_CLIENT) private readonly client: PostgresClient) {}

  /**
   * Closes the pool when the Nest context shuts down. `await app.close()` in a
   * test then really releases the connection, so the suite exits on its own
   * instead of needing a force flag that would also hide a genuine leak.
   */
  async onModuleDestroy(): Promise<void> {
    await this.client.end();
  }
}
