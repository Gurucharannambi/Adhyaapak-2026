# Testing

```bash
npm run db:up      # tests need the Postgres container
npm test           # server + client
npm run typecheck
```

Current totals: 507 server tests, 99 client tests. Paper coverage: image validation and metadata stripping, reader-output interpretation, 20 integration tests (upload, ownership, review gate, approval, rejection, retention) and client review/print tests. Syllabus coverage: text/PDF extraction, proposal building and grounding, and 25 integration tests (upload, generation, review, publish gate).

## Server (`server/`, Vitest + Supertest)

- Runs against the **`adhyaapak_test`** database, never the dev database. `global-setup.ts` applies migrations and refuses to run unless the database name ends in `_test`.
- Files run one at a time (`fileParallelism: false`) because they share that database; each test file resets tables in `beforeEach`.
- `RATE_LIMIT_ENABLED=false` in tests so brute-force limits do not interfere.

### Authentication and classes
Registration (hashing, duplicate email, validation, role cannot be chosen), login/logout/session invalidation, disabled users, generic login failure, audit records without sensitive data, CSRF origin check, error envelope, health and config, role gates, class ownership (404 for other teachers), roster rules, CSV import, dashboard.

### Curriculum
Seed integrity (acyclic graph, one correct option per question, known misconception keys), idempotent seeding that never overwrites edits, and the curriculum API.

### Learning engines (`server/src/modules/learning/`)
Pure logic is tested without a database (`graph`, `mastery`, `assessment`, `misconception`, `adaptation`). `persistence/learning.integration.test.ts` runs the full loop against the test database: transactional writes, idempotent retries (including three simultaneous retries), rollback on invalid input, review workflow, permissions, and rebuilding mastery from evidence.

### Classroom API (`server/src/modules/classroom/classroom.test.ts`)
HTTP-level tests of the whole teacher/student flow: building and opening an activity (one open per class), joining (identical errors for wrong code and wrong number), what a student can and cannot see (the response is checked for answer keys, tags and explanations), idempotent answers, closed activities, withdrawn students, Fast Entry Grid (per-row saving, duplicates, after close), another teacher getting 404 on every route, and the learning map, evidence drill-down and misconception review.

### Interventions (`server/src/modules/interventions/interventions.test.ts`, `adaptation/effectiveness.test.ts`)
The Branch Board from stored evidence (one wrong answer never reaches the foundation lane), assignment (server-side recomputation, required reason for moves, duplicates skipped, audit entry), follow-ups (no repeated questions, linked to the activity, refused when too few new items), the derived "did it help?" (no claim before two new counted answers), finishing activities, student history, and 404s for other teachers.

### Lessons (`server/src/modules/lessons/`)
The lesson flow is tested as pure logic (no question used twice, empty segments instead of repeats, deterministic). The API tests cover class insight from real records, the coverage tracker (mark, unmark, per-class, audited) and, most importantly, **presentation content**: the response is checked to contain no answer keys, misconception tags, explanations, teacher notes, student names or class data, only whitelisted fields pass through even if stored content gains new ones, unapproved material is left out, and joined students and anonymous callers are refused.

### AI (`server/src/modules/ai/`)
No test calls a real model. The provider adapter is tested with a scripted chat stand-in: validated output and metadata, retries with exponential backoff, `Retry-After`, no retry on 400/401/402/403/422, giving up after the configured retries, timeouts, one extra try for unusable output, our own rate limit, provider messages and keys never reaching callers or logs, and the AI-off provider. The arithmetic verifier is tested on addition, subtraction, comparison and equivalence questions (including mistakes a live model really made) and must agree with every applicable hand-written seed question. The drafting and review API uses a scripted provider (`server/src/test/scripted-provider.ts`): good drafts saved as drafts, bad ones discarded with reasons, no draft reaching the concept page, lesson, presentation, suggestions or new activities, the by-hand confirmation rule, ownership (404 for other teachers), caps, and safe messages for every failure kind.

## Client (`client/`, Vitest + Testing Library + jsdom)

The API is mocked at `fetch`, so no server is needed. Covers sign-in and routing, server validation errors, network-down messages, roster import preview, the concept page, the Fast Entry Grid parser, student join and play (including that a student never sees right or wrong), the Branch Board (a move needs a reason before it can be assigned), the lesson workspace (per-segment level switching, answers hidden until asked) presentation mode (it requests only the presentation endpoint, never class data, and shows no answer keys) and the AI drafts screen (AI-off state, discarded-draft reasons, the by-hand confirmation before approving unverified drafts, failed checks blocking approval).

## Not covered yet

Browser end-to-end tests (Playwright). The classroom loop has been checked by hand in a real browser, but there is no automated browser test yet. AI tests will use a mocked provider (Phase 5).

## Added in Phases 7–9

- **Offline and sync**: server `offline.test.ts` (pack contents, idempotent sync, interrupted sync, conflicts) and client `queue.test.ts` (durable queue with `fake-indexeddb`, partial failure, lost replies), `offline.test.tsx` (screens). Also checked by hand in a real browser with a production build and the servers stopped (see `docs/OFFLINE-SYNC.md`).
- **Brief, revisit, home note, portal**: `brief.test.ts`, `portal.test.ts` (including that nothing technical, no answers before answering, and no other student's data reach a student), `brief.test.tsx`.
- **Content packages**: `content.test.ts` (package checks, decimal arithmetic, importing a second chapter, a re-run, drafts versus approved, an all-or-nothing error, running a full diagnostic on the imported chapter, translations, the atlas).
- **Security**: `route-security.test.ts` (every route, found automatically), `logger.test.ts` (no personal data in error logs), `student-data.test.ts` (correcting and erasing a student).
- **Load**: `map-load.test.ts` times the learning map, misconceptions, brief and branch board for 40 students across 15 concepts. Latest run: 20 ms, 12 ms, 89 ms and 33 ms. It fails above 3 s to catch accidental N+1 queries. No extra index was needed. This is one machine and a synthetic class; it is not a capacity plan.

To try offline behaviour yourself: `npm run build -w client`, start the API with `APP_BASE_URL=http://localhost:4173`, `npm run preview -w client`, sign in, prepare a pack, then stop both servers.

## Added with the live classroom work

- **Server:** `run-machine.test.ts` (every state/event pair, repeats are no-ops), `copilot.test.ts` (no evidence, thin evidence, certainty caps, AI action only when available), `copilot.integration.test.ts` (real DB: no-evidence message, suggestions with evidence, AI-off fallback, AI draft stays `draft`, a failed model leaves no draft and leaks nothing, 404 for other teachers, history order and reload).
- **Client:** `fraction-model.test.ts` (equivalence, limits, steps, undo), `FractionCanvas.test.tsx` (steppers and messages, all pictures agree, reveal, hints, persistence), `conceptMapModel.test.ts` and `ConceptMapPage.test.tsx`, `copilot.test.tsx` (evidence shown, preview before use, prerequisite check launch, AI draft labelled, failure and AI-off states), plus the end-session confirmation in `run-flow.test.tsx`.
- **By hand in a real browser (2026-10-29):** start lesson, change the fraction, reveal a step, start a check, two students answered from a separate HTTP client (one retried with the same key, stored once), live scores updated without reload, rows confirmed in Postgres, results distribution, copilot ("not enough information" at 2 of 6), concept map and back, end session, reload and reopen the summary. Not tried by hand: a student's own browser, a live Mesh call, 1366×768 projector.
- Run server tests only from `server/`; from the repo root they hit the dev database.
- **Quick polls:** server `polls/poll.test.ts` (wording and request validation; the live lifecycle; one answer per student even on a retry; the student sees no counts; the teacher sees no student identity; closed polls refuse votes; one open poll per class; no poll during a check and a check closes the poll; no evidence or mastery rows; 404 for another teacher; audit entries). Client `lessons/polls/polls.test.tsx` (live counts written as numbers, asking a true/false poll, plain refusal message, last closed poll stays readable, student screen with no counts, pick-before-send). Checked by hand on 2026-10-29: teacher opened a poll in the browser, three students answered from a separate HTTP client, the drawer updated live (3 of 6), closing it stopped new joins, no evidence rows were written. The student's own poll screen was not checked in a browser.

## Added with the redesign

- **Server:** `insights/insights.test.ts` (growth rules; track and review rules; a single wrong answer stays a single observation and is not "needs investigation"; repeated evidence with the real answers; inconclusive and dismiss keep evidence; Atlas and Insights private to the class's teacher; Insights denominators and change between checks; checks listed across the teacher's own classes only; the dashboard week). `run.test.ts` (pause/resume), `polls/short-answer.test.ts`, `run-machine.test.ts`.
- **Client:** `insights/redesign.test.tsx` (Atlas workspace, Insights, Classes, Assessments, the shell's seven destinations and live counts), `steps/NextStepsPanel` via `run-flow.test.tsx`, `polls/polls.test.tsx`, `copilot/copilot.test.tsx`.
- **By hand (2026-10-29):** Today, Insights and Atlas checked in a real browser at about 1316 px wide after running `npm run db:seed-demo -w server`.
