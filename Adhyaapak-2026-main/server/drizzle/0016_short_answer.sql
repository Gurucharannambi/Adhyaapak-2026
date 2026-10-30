ALTER TYPE "public"."poll_kind" ADD VALUE 'short_answer';--> statement-breakpoint
ALTER TABLE "poll_votes" ALTER COLUMN "option_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "class_polls" ADD COLUMN "expected_answer" text;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD COLUMN "answer_text" text;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_one_kind_ck" CHECK (("poll_votes"."option_id" is null) <> ("poll_votes"."answer_text" is null));