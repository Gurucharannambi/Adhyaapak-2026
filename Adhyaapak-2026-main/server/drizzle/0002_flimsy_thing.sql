CREATE TYPE "public"."assessment_status" AS ENUM('draft', 'approved', 'open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."assessment_type" AS ENUM('diagnostic', 'prerequisite_pulse', 'follow_up', 'practice');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('in_progress', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."evidence_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."evidence_result" AS ENUM('correct', 'partial', 'incorrect', 'insufficient');--> statement-breakpoint
CREATE TYPE "public"."evidence_review_status" AS ENUM('not_required', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('device_response', 'teacher_entered', 'paper_reviewed', 'offline_synced', 'practice_activity');--> statement-breakpoint
CREATE TYPE "public"."mastery_status" AS ENUM('not_enough_evidence', 'needs_foundation', 'developing', 'likely_secure', 'ready_for_challenge');--> statement-breakpoint
CREATE TYPE "public"."misconception_status" AS ENUM('candidate', 'likely', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."self_confidence" AS ENUM('sure', 'unsure', 'guess');--> statement-breakpoint
CREATE TABLE "assessment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"submission_source" "evidence_source" NOT NULL,
	"status" "attempt_status" DEFAULT 'submitted' NOT NULL,
	"sync_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assessment_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"question_response_id" uuid NOT NULL,
	"source" "evidence_source" NOT NULL,
	"result" "evidence_result" NOT NULL,
	"difficulty" integer NOT NULL,
	"self_confidence" "self_confidence",
	"confidence" "evidence_confidence" NOT NULL,
	"review_status" "evidence_review_status" NOT NULL,
	"relationship" text DEFAULT 'primary' NOT NULL,
	"matched_misconception_pattern_id" uuid,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_difficulty_range" CHECK ("assessment_evidence"."difficulty" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "assessment_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"sequence_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"title" text NOT NULL,
	"type" "assessment_type" NOT NULL,
	"status" "assessment_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "concept_mastery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"estimate" double precision NOT NULL,
	"status" "mastery_status" NOT NULL,
	"evidence_count" integer NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	"algorithm_version" text NOT NULL,
	"last_evidence_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mastery_estimate_range" CHECK ("concept_mastery"."estimate" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "misconception_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"pattern_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"status" "misconception_status" DEFAULT 'candidate' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"response_data" jsonb NOT NULL,
	"self_confidence" "self_confidence",
	"result" "evidence_result" NOT NULL,
	"result_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_student_id_student_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_evidence" ADD CONSTRAINT "assessment_evidence_student_id_student_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_evidence" ADD CONSTRAINT "assessment_evidence_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_evidence" ADD CONSTRAINT "assessment_evidence_question_response_id_question_responses_id_fk" FOREIGN KEY ("question_response_id") REFERENCES "public"."question_responses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_evidence" ADD CONSTRAINT "assessment_evidence_matched_misconception_pattern_id_misconception_patterns_id_fk" FOREIGN KEY ("matched_misconception_pattern_id") REFERENCES "public"."misconception_patterns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_mastery" ADD CONSTRAINT "concept_mastery_student_id_student_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_mastery" ADD CONSTRAINT "concept_mastery_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_observations" ADD CONSTRAINT "misconception_observations_student_id_student_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_observations" ADD CONSTRAINT "misconception_observations_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_observations" ADD CONSTRAINT "misconception_observations_pattern_id_misconception_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."misconception_patterns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_observations" ADD CONSTRAINT "misconception_observations_evidence_id_assessment_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."assessment_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_observations" ADD CONSTRAINT "misconception_observations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_responses" ADD CONSTRAINT "question_responses_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_responses" ADD CONSTRAINT "question_responses_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_assessment_student_uq" ON "assessment_attempts" USING btree ("assessment_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_sync_uq" ON "assessment_attempts" USING btree ("sync_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_response_concept_uq" ON "assessment_evidence" USING btree ("question_response_id","concept_id");--> statement-breakpoint
CREATE INDEX "evidence_student_concept_idx" ON "assessment_evidence" USING btree ("student_id","concept_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_questions_uq" ON "assessment_questions" USING btree ("assessment_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_questions_order_uq" ON "assessment_questions" USING btree ("assessment_id","sequence_order");--> statement-breakpoint
CREATE INDEX "assessments_class_idx" ON "assessments" USING btree ("class_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mastery_student_concept_uq" ON "concept_mastery" USING btree ("student_id","concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_evidence_uq" ON "misconception_observations" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "observations_student_pattern_idx" ON "misconception_observations" USING btree ("student_id","pattern_id");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_attempt_question_uq" ON "question_responses" USING btree ("attempt_id","question_id");