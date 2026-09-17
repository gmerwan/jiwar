import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type JiwarDb } from "../db/drizzle.module.js";
import { participants } from "../db/schema.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ParticipantsService {
  constructor(@Inject(DRIZZLE) private readonly db: JiwarDb) {}

  /** Returns the existing participant id if it is valid and known, otherwise creates a new one. */
  async ensure(existingId?: string): Promise<string> {
    if (existingId && UUID_PATTERN.test(existingId)) {
      const found = await this.db
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.id, existingId))
        .limit(1);
      if (found[0]) return found[0].id;
    }

    const inserted = await this.db.insert(participants).values({}).returning({ id: participants.id });
    const row = inserted[0];
    if (!row) throw new Error("Failed to create participant");
    return row.id;
  }
}
