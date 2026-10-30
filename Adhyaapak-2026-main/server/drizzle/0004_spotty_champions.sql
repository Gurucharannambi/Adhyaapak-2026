CREATE TYPE "public"."activity_type" AS ENUM('prerequisite_diagnostic', 'foundation_activity', 'guided_practice', 'challenge_activity', 'follow_up_assessment', 'revisit_question', 'teacher_review');--> statement-breakpoint
CREATE TYPE "public"."group_key" AS ENUM('foundation', 'guided', 'challenge', 'follow_up');--> statement-breakpoint
CREATE TYPE "public"."intervention_status" AS ENUM('assigned', 'completed', 'dismissed');--> statement-breakpoint
CREATE TABLE "interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"target_concept_id" uuid NOT NULL,
	"group_key" "group_key" NOT NULL,
	"recommended_group_key" "group_key" NOT NULL,
	"activity_type" "activity_type" NOT NULL,
	"recommended_activity_type" "activity_type" NOT NULL,
	"moved_reason" text,
	"reason" text NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	"prerequisite_concept_ids" jsonb NOT NULL,
	"status" "intervention_status" DEFAULT 'assigned' NOT NULL,
	"status_at_assignment" "mastery_status" NOT NULL,
	"estimate_at_assignment" double precision NOT NULL,
	"evidence_count_at_assignment" integer NOT NULL,
	"policy_version" text NOT NULL,
	"teacher_note" text,
	"follow_up_assessment_id" uuid,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_student_id_student_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_target_concept_id_concepts_id_fk" FOREIGN KEY ("target_concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_follow_up_assessment_id_assessments_id_fk" FOREIGN KEY ("follow_up_assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interventions_one_active_uq" ON "interventions" USING btree ("class_id","student_id","concept_id") WHERE "interventions"."status" = 'assigned';--> statement-breakpoint
CREATE INDEX "interventions_class_concept_idx" ON "interventions" USING btree ("class_id","concept_id");--> statement-breakpoint
CREATE INDEX "interventions_student_idx" ON "interventions" USING btree ("student_id","assigned_at");