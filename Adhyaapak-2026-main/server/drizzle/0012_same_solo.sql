CREATE TABLE "lesson_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"run_date" text NOT NULL,
	"assessment_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"wrapped_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "lesson_runs" ADD CONSTRAINT "lesson_runs_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_runs" ADD CONSTRAINT "lesson_runs_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_runs" ADD CONSTRAINT "lesson_runs_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_runs_uq" ON "lesson_runs" USING btree ("class_id","concept_id","run_date");--> statement-breakpoint
CREATE INDEX "lesson_runs_assessment_idx" ON "lesson_runs" USING btree ("assessment_id");