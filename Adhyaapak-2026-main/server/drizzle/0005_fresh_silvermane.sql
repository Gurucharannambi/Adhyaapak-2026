CREATE TABLE "lesson_coverage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"taught_by" uuid NOT NULL,
	"taught_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson_coverage" ADD CONSTRAINT "lesson_coverage_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_coverage" ADD CONSTRAINT "lesson_coverage_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_coverage" ADD CONSTRAINT "lesson_coverage_taught_by_users_id_fk" FOREIGN KEY ("taught_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_coverage_uq" ON "lesson_coverage" USING btree ("class_id","concept_id");