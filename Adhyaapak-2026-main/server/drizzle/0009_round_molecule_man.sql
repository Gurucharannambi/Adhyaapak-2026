CREATE TYPE "public"."sync_status" AS ENUM('applied', 'conflict', 'rejected', 'discarded');--> statement-breakpoint
CREATE TABLE "offline_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"operation_type" text NOT NULL,
	"base_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "sync_status" NOT NULL,
	"reason_code" text,
	"message" text,
	"attempt_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "offline_packs" ADD CONSTRAINT "offline_packs_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_packs" ADD CONSTRAINT "offline_packs_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_packs" ADD CONSTRAINT "offline_packs_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_packs" ADD CONSTRAINT "offline_packs_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "packs_class_idx" ON "offline_packs" USING btree ("class_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_ops_key_uq" ON "sync_operations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sync_ops_user_idx" ON "sync_operations" USING btree ("user_id","status");