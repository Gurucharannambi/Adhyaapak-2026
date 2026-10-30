CREATE TYPE "public"."poll_kind" AS ENUM('choice', 'true_false', 'confidence');--> statement-breakpoint
CREATE TYPE "public"."poll_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "class_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"concept_id" uuid,
	"teacher_id" uuid NOT NULL,
	"kind" "poll_kind" NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"status" "poll_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"option_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_polls" ADD CONSTRAINT "class_polls_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_polls" ADD CONSTRAINT "class_polls_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_polls" ADD CONSTRAINT "class_polls_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_class_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."class_polls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_student_id_student_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_polls_class_idx" ON "class_polls" USING btree ("class_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "class_polls_one_open_per_class_uq" ON "class_polls" USING btree ("class_id") WHERE "class_polls"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "poll_votes_poll_student_uq" ON "poll_votes" USING btree ("poll_id","student_id");