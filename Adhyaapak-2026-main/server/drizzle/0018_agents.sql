CREATE TYPE "public"."agent_kind" AS ENUM('intervention_planner', 'lesson_prep', 'check_followup');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'awaiting_approval', 'approved', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" "agent_kind" NOT NULL,
	"user_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"concept_id" uuid,
	"pattern_id" uuid,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"plan" jsonb,
	"pseudonyms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"reason" text NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"observation" text NOT NULL,
	"ok" boolean NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_pattern_id_misconception_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."misconception_patterns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_class_idx" ON "agent_runs" USING btree ("class_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_steps_run_idx" ON "agent_steps" USING btree ("run_id","step_index");