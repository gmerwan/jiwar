import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { geographyPoint } from "./geography.js";

export const attendanceEnum = pgEnum("attendance", [
  "public",
  "invitation_only",
  "restricted",
]);

export const noticeStatusEnum = pgEnum("notice_status", [
  "published",
  "cancelled",
  "removed",
]);

export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  icon: varchar("icon", { length: 32 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const notices = pgTable(
  "notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: varchar("public_id", { length: 16 }).notNull().unique(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    venueName: varchar("venue_name", { length: 160 }).notNull(),
    address: varchar("address", { length: 400 }).notNull(),
    location: geographyPoint("location").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    attendance: attendanceEnum("attendance").notNull(),
    organizerName: varchar("organizer_name", { length: 160 }),
    organizerContact: varchar("organizer_contact", { length: 160 }),
    status: noticeStatusEnum("status").notNull().default("published"),
    authorParticipantId: uuid("author_participant_id")
      .notNull()
      .references(() => participants.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notices_location_gist").using("gist", t.location),
    index("notices_starts_at_idx").on(t.startsAt),
    index("notices_category_idx").on(t.categoryId),
  ],
);

export const noticesRelations = relations(notices, ({ one }) => ({
  category: one(categories, {
    fields: [notices.categoryId],
    references: [categories.id],
  }),
}));

export const schema = { participants, categories, notices, noticesRelations };
