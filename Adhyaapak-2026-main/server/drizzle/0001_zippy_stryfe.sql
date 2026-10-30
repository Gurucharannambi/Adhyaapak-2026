CREATE TYPE "public"."enrolment_status" AS ENUM('active', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."question_role" AS ENUM('diagnostic', 'guided', 'challenge');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('explanation', 'worked_example', 'teacher_note');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('draft', 'reviewed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."teaching_level" AS ENUM('foundation', 'guided', 'challenge');--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"chapter_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"roster_number" integer NOT NULL,
	"status" "enrolment_status" DEFAULT 'active' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid,
	"teacher_id" uuid NOT NULL,
	"name" text NOT NULL,
	"grade" integer NOT NULL,
	"academic_year" text NOT NULL,
	"join_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classes_join_code_unique" UNIQUE("join_code"),
	CONSTRAINT "classes_grade_range" CHECK ("classes"."grade" between 6 and 10)
);
--> statement-breakpoint
CREATE TABLE "concept_prerequisites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prerequisite_concept_id" uuid NOT NULL,
	"dependent_concept_id" uuid NOT NULL,
	"source_reference" text,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prerequisites_no_self_edge" CHECK ("concept_prerequisites"."prerequisite_concept_id" <> "concept_prerequisites"."dependent_concept_id")
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"learning_objective" text NOT NULL,
	"concept_order" integer NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"provenance" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"board" text NOT NULL,
	"academic_year" text NOT NULL,
	"grade" integer NOT NULL,
	"subject_id" uuid NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_reference" text,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curriculum_grade_range" CHECK ("curriculum_versions"."grade" between 6 and 10)
);
--> statement-breakpoint
CREATE TABLE "learning_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" "resource_type" NOT NULL,
	"level" "teaching_level",
	"title" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"content" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_resources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "misconception_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"concept_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"trigger_definition" jsonb NOT NULL,
	"follow_up_definition" jsonb NOT NULL,
	"recommended_explanation" text NOT NULL,
	"example_wrong_answers" jsonb NOT NULL,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "misconception_patterns_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "question_concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"relationship_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"concept_id" uuid NOT NULL,
	"role" "question_role" NOT NULL,
	"difficulty" integer NOT NULL,
	"stem" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_option_id" text NOT NULL,
	"explanation" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"provenance" jsonb NOT NULL,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_key_unique" UNIQUE("key"),
	CONSTRAINT "questions_difficulty_range" CHECK ("questions"."difficulty" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"reference_id" text,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "subjects_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_curriculum_version_id_curriculum_versions_id_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "public"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrolments" ADD CONSTRAINT "class_enrolments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrolments" ADD CONSTRAINT "class_enrolments_student_id_student_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_prerequisites" ADD CONSTRAINT "concept_prerequisites_prerequisite_concept_id_concepts_id_fk" FOREIGN KEY ("prerequisite_concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_prerequisites" ADD CONSTRAINT "concept_prerequisites_dependent_concept_id_concepts_id_fk" FOREIGN KEY ("dependent_concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_curriculum_version_id_curriculum_versions_id_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "public"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_versions" ADD CONSTRAINT "curriculum_versions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resources" ADD CONSTRAINT "learning_resources_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_patterns" ADD CONSTRAINT "misconception_patterns_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_concepts" ADD CONSTRAINT "question_concepts_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_concepts" ADD CONSTRAINT "question_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_order_uq" ON "chapters" USING btree ("curriculum_version_id","chapter_order");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolments_class_student_uq" ON "class_enrolments" USING btree ("class_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolments_class_roster_uq" ON "class_enrolments" USING btree ("class_id","roster_number");--> statement-breakpoint
CREATE INDEX "enrolments_student_idx" ON "class_enrolments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "classes_teacher_idx" ON "classes" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prerequisites_pair_uq" ON "concept_prerequisites" USING btree ("prerequisite_concept_id","dependent_concept_id");--> statement-breakpoint
CREATE INDEX "prerequisites_dependent_idx" ON "concept_prerequisites" USING btree ("dependent_concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_key_uq" ON "concepts" USING btree ("curriculum_version_id","key");--> statement-breakpoint
CREATE INDEX "concepts_chapter_idx" ON "concepts" USING btree ("chapter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_versions_uq" ON "curriculum_versions" USING btree ("board","academic_year","grade","subject_id","language","version");--> statement-breakpoint
CREATE INDEX "resources_concept_idx" ON "learning_resources" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "misconceptions_concept_idx" ON "misconception_patterns" USING btree ("concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_concepts_uq" ON "question_concepts" USING btree ("question_id","concept_id");--> statement-breakpoint
CREATE INDEX "questions_concept_idx" ON "questions" USING btree ("concept_id");