CREATE TABLE "timetable_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"period" smallint NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"subject" text NOT NULL,
	CONSTRAINT "timetable_weekday" CHECK ("timetable_slots"."weekday" between 1 and 6)
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "key_ideas" jsonb;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_slots_uq" ON "timetable_slots" USING btree ("class_id","weekday","period");