CREATE TYPE "public"."ai_run_status" AS ENUM('ok', 'failed');--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"workflow" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"concept_id" uuid,
	"status" "ai_run_status" NOT NULL,
	"error_code" text,
	"duration_ms" integer NOT NULL,
	"attempts" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learning_resources" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "learning_resources" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "learning_resources" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_user_idx" ON "ai_runs" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "learning_resources" ADD CONSTRAINT "learning_resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resources" ADD CONSTRAINT "learning_resources_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;