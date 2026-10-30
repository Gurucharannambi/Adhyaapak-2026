CREATE TABLE "teaching_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"basis" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "owner_student_id" uuid;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "portal_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teaching_briefs" ADD CONSTRAINT "teaching_briefs_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_briefs" ADD CONSTRAINT "teaching_briefs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefs_class_idx" ON "teaching_briefs" USING btree ("class_id","created_at");--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_owner_student_id_student_profiles_id_fk" FOREIGN KEY ("owner_student_id") REFERENCES "public"."student_profiles"("id") ON DELETE restrict ON UPDATE no action;