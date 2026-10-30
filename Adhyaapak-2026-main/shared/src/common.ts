import { z } from "zod";

export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

export const Role = z.enum(["teacher", "student", "admin"]);
export type Role = z.infer<typeof Role>;

/** Classes 6-10 are in scope (CLAUDE.md §1). */
export const Grade = z.number().int().min(6).max(10);
export type Grade = z.infer<typeof Grade>;

/** BCP-47-style language tag, e.g. "en", "hi". Content always carries one (Feature 15). */
export const Language = z.string().min(2).max(16);
export type Language = z.infer<typeof Language>;

/**
 * Lifecycle of anything AI- or teacher-authored (principle 3: AI proposes, teacher disposes).
 * Only `approved` content may be shown to students or used as authoritative.
 */
export const ReviewStatus = z.enum(["draft", "reviewed", "approved", "rejected"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/** Where a piece of content came from (CLAUDE.md §2 provenance). */
export const Provenance = z.object({
  source: z.enum(["original", "teacher_upload", "ai_draft", "licensed", "official_reference"]),
  reference: z.string().optional(),
  note: z.string().optional(),
});
export type Provenance = z.infer<typeof Provenance>;
