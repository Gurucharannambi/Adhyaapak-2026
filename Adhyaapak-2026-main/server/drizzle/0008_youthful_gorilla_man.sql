CREATE TYPE "public"."extraction_status" AS ENUM('ok', 'failed');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('uploaded', 'needs_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "evaluation_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_file_id" uuid NOT NULL,
	"extraction_result_id" uuid,
	"items" jsonb NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_file_id" uuid NOT NULL,
	"extractor" text NOT NULL,
	"processing_version" text NOT NULL,
	"status" "extraction_status" NOT NULL,
	"error_code" text,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"storage_key" text,
	"file_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"content_hash" text NOT NULL,
	"metadata_stripped" boolean DEFAULT false NOT NULL,
	"status" "submission_status" DEFAULT 'uploaded' NOT NULL,
	"attempt_id" uuid,
	"delete_after" timestamp with time zone,
	"image_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_reviews" ADD CONSTRAINT "evaluation_reviews_submission_file_id_submission_files_id_fk" FOREIGN KEY ("submission_file_id") REFERENCES "public"."submission_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_reviews" ADD CONSTRAINT "evaluation_reviews_extraction_result_id_extraction_results_id_fk" FOREIGN KEY ("extraction_result_id") REFERENCES "public"."extraction_results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_reviews" ADD CONSTRAINT "evaluation_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD CONSTRAINT "extraction_results_submission_file_id_submission_files_id_fk" FOREIGN KEY ("submission_file_id") REFERENCES "public"."submission_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_student_id_student_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_file_uq" ON "evaluation_reviews" USING btree ("submission_file_id");--> statement-breakpoint
CREATE INDEX "extraction_file_idx" ON "extraction_results" USING btree ("submission_file_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_live_uq" ON "submission_files" USING btree ("assessment_id","student_id") WHERE "submission_files"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "submission_assessment_idx" ON "submission_files" USING btree ("assessment_id","created_at");--> statement-breakpoint
CREATE INDEX "submission_delete_after_idx" ON "submission_files" USING btree ("delete_after");