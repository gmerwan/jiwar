CREATE TYPE "public"."attendance" AS ENUM('public', 'invitation_only', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."notice_status" AS ENUM('published', 'cancelled', 'removed');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"icon" varchar(32) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(16) NOT NULL,
	"category_id" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"venue_name" varchar(160) NOT NULL,
	"address" varchar(400) NOT NULL,
	"location" geography(Point,4326) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"attendance" "attendance" NOT NULL,
	"organizer_name" varchar(160),
	"organizer_contact" varchar(160),
	"status" "notice_status" DEFAULT 'published' NOT NULL,
	"author_participant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notices_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_author_participant_id_participants_id_fk" FOREIGN KEY ("author_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notices_location_gist" ON "notices" USING gist ("location");--> statement-breakpoint
CREATE INDEX "notices_starts_at_idx" ON "notices" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "notices_category_idx" ON "notices" USING btree ("category_id");