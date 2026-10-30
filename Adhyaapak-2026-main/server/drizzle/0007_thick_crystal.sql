CREATE TYPE "public"."edge_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."edge_decision" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."edge_grounding" AS ENUM('document', 'inferred', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'published', 'discarded');--> statement-breakpoint
CREATE TABLE "graph_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"board" text NOT NULL,
	"academic_year" text NOT NULL,
	"grade" integer NOT NULL,
	"subject_name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"notes" jsonb NOT NULL,
	"published_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "proposal_concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"learning_objective" text NOT NULL,
	"evidence_quote" text,
	"grounded" boolean NOT NULL,
	"position" integer NOT NULL,
	"added_by_teacher" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"prerequisite_concept_id" uuid NOT NULL,
	"dependent_concept_id" uuid NOT NULL,
	"evidence_quote" text,
	"grounding" "edge_grounding" NOT NULL,
	"confidence" "edge_confidence" NOT NULL,
	"decision" "edge_decision" NOT NULL,
	CONSTRAINT "proposal_edges_no_self" CHECK ("proposal_edges"."prerequisite_concept_id" <> "proposal_edges"."dependent_concept_id")
);
--> statement-breakpoint
CREATE TABLE "syllabus_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"title" text NOT NULL,
	"original_filename" text NOT NULL,
	"file_type" text NOT NULL,
	"content_hash" text NOT NULL,
	"storage_key" text,
	"extracted_text" text NOT NULL,
	"page_count" integer,
	"suspicious" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "graph_proposals" ADD CONSTRAINT "graph_proposals_document_id_syllabus_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."syllabus_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_proposals" ADD CONSTRAINT "graph_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_proposals" ADD CONSTRAINT "graph_proposals_published_version_id_curriculum_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_concepts" ADD CONSTRAINT "proposal_concepts_proposal_id_graph_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."graph_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_edges" ADD CONSTRAINT "proposal_edges_proposal_id_graph_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."graph_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_edges" ADD CONSTRAINT "proposal_edges_prerequisite_concept_id_proposal_concepts_id_fk" FOREIGN KEY ("prerequisite_concept_id") REFERENCES "public"."proposal_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_edges" ADD CONSTRAINT "proposal_edges_dependent_concept_id_proposal_concepts_id_fk" FOREIGN KEY ("dependent_concept_id") REFERENCES "public"."proposal_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_documents" ADD CONSTRAINT "syllabus_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposals_creator_idx" ON "graph_proposals" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_concepts_key_uq" ON "proposal_concepts" USING btree ("proposal_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_edges_pair_uq" ON "proposal_edges" USING btree ("proposal_id","prerequisite_concept_id","dependent_concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "syllabus_owner_hash_uq" ON "syllabus_documents" USING btree ("uploaded_by","content_hash");