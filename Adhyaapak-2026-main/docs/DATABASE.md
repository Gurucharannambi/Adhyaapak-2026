# Database

PostgreSQL 16 via Drizzle ORM. Schema: `server/src/db/schema.ts`. Migrations: `server/drizzle/` (generated with `npm run db:generate -w server`, applied with `npm run db:migrate`). Never edit an applied migration; generate a new one.

## Tables

| Area | Table | Notes |
|---|---|---|
| Identity | `users`, `sessions`, `schools` | Unique `lower(email)`. Sessions store only a SHA-256 hash of the cookie token. |
| Audit | `audit_log` | Append-only. `actor_id` is deliberately not a foreign key so audit rows outlive users. |
| Classroom | `classes`, `student_profiles`, `class_enrolments` | `classes.join_code` unique. Enrolment unique on (class, student) and (class, roster_number). Withdrawn students keep their number reserved. Student identity is separate from learning data. |
| Student access | `student_sessions` | Created when a student joins with the class join code + roster number. Stores only a SHA-256 hash of the cookie token; expires after 3 hours; can only answer the class's open activity. |
| Curriculum | `subjects`, `curriculum_versions`, `chapters`, `concepts`, `concept_prerequisites` | Concepts have a stable `key`. Edge A→B means A is a prerequisite for B. A CHECK constraint forbids self-edges. Every row carries `language`; content rows carry `review_status` and `provenance`. |
| Content | `learning_resources`, `questions`, `question_concepts`, `misconception_patterns` | Question options are JSON; a wrong option may carry a `misconceptionKey`. Misconception rules are validated data, never code. |
| Assessment | `assessments`, `assessment_questions`, `assessment_attempts`, `question_responses` | One attempt per student per assessment; `sync_id` is a unique idempotency key. Status moves draft → approved → open → closed. A partial unique index allows **at most one open activity per class**, so a joining student is never ambiguous. |
| Evidence | `assessment_evidence` | The ledger. Unique per (response, concept). Rows are never deleted; only `review_status` changes, through review workflows. `relationship` is `primary` or `also_assesses`. |
| Learning state | `concept_mastery`, `misconception_observations` | `concept_mastery` is a recomputable cache (`algorithm_version` stored). Observations link a response's evidence to a rule and carry candidate / likely / confirmed / rejected plus reviewer and time. |
| Interventions | `interventions` | One row per student activity. Stores the teacher's final lane and activity next to the system's recommendation (and a reason if they differ), the evidence ids behind it, and a snapshot of the student's state when assigned. At most one active row per student per concept. Whether it helped is derived from the ledger on request, never stored. |
| Lessons | `lesson_coverage` | A row means the teacher marked the concept as taught to that class. Unmarking deletes the row; the audit log keeps the history. |
| Syllabus | `syllabus_documents`, `graph_proposals`, `proposal_concepts`, `proposal_edges` | Uploaded document metadata (file in private storage), AI proposals, per-edge grounding, confidence and teacher decision. Publishing creates a new `curriculum_versions` row. |
| Paper | `submission_files`, `extraction_results`, `evaluation_reviews` | A photographed sheet (private storage key, hash, status, retention dates), what the reader saw (immutable per run), and the teacher's reviewed answers. Approval creates an ordinary attempt with source `paper_reviewed`. |
| Offline | `offline_packs`, `sync_operations` | A pack ties a class, a lesson and a created activity to a `content_hash` (the version offline work is recorded against). `sync_operations.idempotency_key` is unique; conflicts keep their payload until a teacher resolves them. |
| Briefs | `teaching_briefs` | Items (measured or inferred, with evidence references and the teacher's decisions) are stored as JSON because each brief is a snapshot of what the records said at the time. |
| Portal | `classes.portal_enabled`, `assessments.owner_student_id` | The portal is off until the teacher turns it on. A student's practice set is an assessment owned by that student and hidden from class lists. |
| AI | `ai_runs` | One row per AI call: workflow, prompt version, model, concept, status, error code, duration, attempts. Metadata only: no prompts, no responses, no student data. |

## Conventions

- UUID primary keys. `timestamptz` everywhere.
- `ON DELETE RESTRICT` for anything that carries history (classes, enrolments, curriculum, evidence). Nothing important is cascade-deleted.
- `questions` and `learning_resources` carry `created_by`, `reviewed_by` and `reviewed_at`. AI drafts are created as `draft`, are visible only to their author, and become visible to others only when approved.
- Seeds use `ON CONFLICT DO NOTHING` on stable keys, so re-running never overwrites teacher edits.
- Tests run on `adhyaapak_test` only; the test setup refuses any other database name.

Tables for paper submissions and offline sync arrive in Phases 6 and 7.

## Quick polls (migration `0014_quick_polls`)

- `class_polls`: class, optional lesson (concept), teacher, kind (`choice | true_false | confidence`), prompt, options (jsonb `{id, text}`), status (`open | closed`), created/closed timestamps. Partial unique index: one open poll per class.
- `poll_votes`: poll, student, option id, created at. Unique on (poll, student): one answer each. Not linked to `assessment_evidence` or `concept_mastery` by design.

## Migrations since the quick-poll work

- `0015_run_pause`: `lesson_runs.paused_at` (a running check can be paused; device answers wait).
- `0016_short_answer`: `poll_kind` gains `short_answer`; `class_polls.expected_answer`; `poll_votes.answer_text`, with `option_id` now nullable and a check that exactly one of the two is set.
- `0017_inconclusive`: `misconception_status` gains `inconclusive`.
