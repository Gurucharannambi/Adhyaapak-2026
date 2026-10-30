# Adhyaapak — Architecture

A **modular monolith**: one React PWA, one Express application, one PostgreSQL database. Modules are separated by folder and by interface, not by network. Describes the target design; modules are built phase by phase (see `phases.md`).

```
client/ (React PWA)  ──REST /api/v1──▶  server/ (Express)  ──▶  PostgreSQL
  service worker                           modules/              private file storage
  IndexedDB + op queue                       auth, classes, curriculum, lessons,
                                             assessments, learning (see below),
                                             interventions, sync, files, briefs,
                                             ai  ──▶ LangChain ──▶ Mesh adapter ──▶ api.meshapi.ai
shared/ (types + Zod schemas used by both)
```

## Module boundaries (server)

Route handlers stay thin: parse and validate → call a service → map the result. Business rules live in services.

| Module | Owns | Must NOT |
|---|---|---|
| `auth` | users, sessions, roles, permission helpers | contain business rules of other modules |
| `classes` | classes, enrolments, roster import | compute learning state |
| `curriculum` | chapters, concepts, prerequisites, graph versions | call the LLM directly |
| `learning/graph` | traversal, cycle checks, sequences | use the LLM for validity |
| `learning/assessment` | question selection, evaluation, evidence writes | decide adaptation |
| `learning/misconception` | rule matching, follow-up requests | execute code stored in the DB |
| `learning/mastery` | `MasteryEstimator` implementations | depend on a specific algorithm elsewhere |
| `learning/adaptation` | next-activity policy, Recommendation Contract | call external services |
| `interventions` | groups, assignments, follow-up tracking | |
| `ai` | Mesh adapter, LangChain chains, schemas | touch auth, DB permissions, or write authoritative records |
| `offline` | lesson packs, idempotent sync intake, the conflict inbox | accept arbitrary mutations (only `record_responses`) |
| `paper` | photographed sheets: validation, metadata removal, reading (AI) kept apart from judging, review, approval, retention | let a reading become evidence before a teacher approves it |
| `brief` | teaching brief, revisit queue, home note: built from queries only | let a model write a claim; show student names in a print |
| `portal` | the optional student side: next step, practice sets, hint ladder | show answers before a question is answered, or diagnostic labels |
| `syllabus` | upload → proposal → teacher-reviewed publish as a new curriculum version | publish without confirmation |
| `curriculum/content` | content packages (chapters and translations as data), validation, import, the misconception atlas | write anything if a package has one error |
| `files` | `StorageProvider`, upload validation | expose public URLs |

Dependency direction: `routes → services → repositories`. `learning/*` is pure logic over typed inputs and is testable with no database. `ai` is called by services and never by routes; its output is always a **draft** until a review action.

## Data flow of the core loop

1. Teacher launches a diagnostic → students answer (device, join code + roster number) or the teacher keys paper answers (Fast Entry Grid).
2. `assessment` evaluates deterministically and writes **evidence rows** in one transaction (with self-confidence).
3. `misconception` matches distractors/patterns → a `Diagnosis` (needs corroboration before "likely").
4. `mastery` recomputes the derived `ConceptMastery` from eligible evidence (`canAffectMastery`).
5. `adaptation` emits `Recommendation`s with reasons and evidence IDs → learning map, Branch Board, Misconception Mirror.
6. Teacher accepts/edits (override stored as signal) → interventions → follow-up assessment → loop.

## Cross-cutting rules (from phases.md principles)

- Evidence is append-only and immutable; mastery is a cache recomputable from it.
- Anything AI-generated carries `ReviewStatus` and `Provenance`; only `approved` reaches students.
- Thresholds, labels, model IDs and `APP_NAME` come from config.
- Every route performs an object-level access check through one shared permission function.
- Logs carry request IDs and exclude secrets, tokens and student submissions.

## Graceful degradation

`AI_ENABLED=false` must leave every core step working: deterministic diagnostics, learning map, groups, printed packs. AI features then show a clear "unavailable" state.

## Offline and sync

The browser keeps two things in IndexedDB: lesson packs the teacher chose to download and a queue of defined operations. The service worker caches only the app shell. Sync sends queued operations to `POST /sync/operations`, where each is applied once (unique idempotency key), turned into a conflict for the teacher, or rejected with a reason. The server stays the only source of truth. Details and limits: `docs/OFFLINE-SYNC.md`.

## Teaching brief and student portal

The brief is assembled from the learning map, misconception records and the revisit query; each line is *measured* (a count from records) or *inferred* (a suggestion that names the measured lines it rests on), so an unsupported claim cannot be constructed. The portal reuses the teacher's adaptation policy (`computeRecommendations`) for a student's next step, and writes practice answers through the same evidence pipeline (source `practice_activity`, hints recorded as lighter evidence). Neither calls an LLM. A student's practice sets are private assessments (`assessments.owner_student_id`) that the teacher's class list does not show.

## Adding a chapter, a language, a board

Curriculum content is data. `npm run content:import -w server -- <package.json>` validates a package (references, loops, three explanation levels, question validity, fraction and decimal arithmetic) and writes it in one transaction, linking new concepts to existing ones by key (so a chapter can depend on an earlier chapter). Resources carry a `language`; every read of a concept's content filters to the concept's own language, and translations are drafts shown only side by side to teachers until a reader of the language approves them. Class 6 **Decimals** was added this way with no code change, and its first diagnostic runs through the same loop as Fractions (`content.test.ts`). A new board, grade or subject is a package whose `curriculum` block names it.

## Timetable and our own textbook

The teacher's day is driven by a timetable, not by uploads.

- **Textbook:** `Class 6 Mathematics`, in teaching order: Fractions, Decimals, Patterns in Mathematics, Lines and Angles, Data Handling and Presentation (24 lessons). Fractions is seeded in code (`curriculum/seed/`); the other chapters are content packages in `server/content/*.json`, imported by `npm run db:seed` through `seed/book.ts`. All wording is original; chapter titles and scope follow the usual Class 6 syllabus (see CONTENT-PROVENANCE.md). Chapters carry a `summary` and `keyIdeas`.
- **Timetable:** `timetable_slots` (class, weekday 1-6, period, times, subject). A new class gets a sample week (36 periods, 5 of them Mathematics); the teacher can edit subjects on `/classes/:id/timetable`.
- **Lesson plan:** not stored. `modules/timetable/pacing.ts` fills the Mathematics periods, in calendar order, with the next lessons of the book; lessons taught on earlier days are skipped, and a lesson taught today keeps its place. The dashboard shows today's periods; the class page shows the next lesson.
- **Limits:** only Class 6 Mathematics has a textbook so far. Other subjects and grades show their periods but no lessons. Only Fractions and Decimals have misconception rules; the new chapters have diagnostic questions but no misconception patterns yet.
- **Own syllabus upload** still exists (`/syllabus`) for teachers who use a different book, but it is no longer in the main navigation.

## Lesson flow (one period, four steps)

A period is the unit of the teacher's work. `/classes/:classId/lessons/:conceptId` is a four-step page (`?step=prepare|teach|check|wrap`); the step shown follows the real state of the period.

- **State:** `lesson_runs` (class, lesson, day, optional check, wrapped-at). The state (`not_started → teaching → checking → needs_wrap → done`) is derived from that row and the check's status (`modules/lessons/run.service.ts`, `deriveState`). Nothing about it is stored twice.
- **Prepare:** recap of the previous wrapped lesson's patterns, prerequisites with how many students are not yet secure (from recorded answers only), key ideas, and materials (projector, print, offline pack).
- **Teach:** the 5-part plan with the three levels (existing lesson workspace).
- **Check:** one call (`POST .../run/check/start`) picks two or three questions from the approved bank (or the teacher's own choice from this lesson's bank), then creates, approves and opens the check. Collection modes: paper (print slips, keyboard entry grid), student devices (join code), hands-up count (client-only, not saved, never added to a student's record).
- **Wrap up:** per-option counts, the patterns the check showed, advice (`run-recommendation.ts`: deterministic thresholds, always with reason and evidence sufficiency, teacher can dismiss), suggested groups from the Branch Board rules, and Finish, which records the lesson as taught and, only if ticked, assigns the groups.
- **Today:** `GET /dashboard` returns today's periods with each run state, tomorrow's first Mathematics period per class, a "Needs you" list (`GET /attention`: open checks, closed-but-unwrapped checks, sheets to review, patterns awaiting confirmation) and real setup progress.
- **Limits:** the groups panel on the wrap-up is read-only (adjust on the Branch Board); the recommendation thresholds are a starting point, not a validated model; the check collects at class level on the same day only.

## Live assessments

Students answer on their own devices and the teacher watches it happen.

- **Join:** the student enters the class code and roster number (`/join`), then `/play`. The teacher's screen shows them as *Joined* at once.
- **Scoring:** answers are scored when saved (`submitAttempt`), so the teacher's **Live scores** table fills in per student ("1 / 2") as they send. A blank answer is "no evidence", never wrong. Scores are teacher-only; students are never told a score, a percentage or a rank.
- **Push, not polling:** `modules/live/hub.ts` pushes Server-Sent Events: `GET /classes/:id/live` (teacher) and `GET /student/live` (student). Events are only signals (`answers`, `joined`, `opened`, `closed`, `released`); the page re-reads the normal permission-checked API (`client/src/hooks/useLive.ts`). A student's stream only carries `opened`, `closed` and `released`, never a classmate's activity. Polling stays as a slow fallback if the connection drops.
- **Results for students:** after the teacher closes the check, **Show students their results** (`POST /assessments/:id/release-results`) lets each student see only their own answers (right / not this time / left blank), the right answer and the explanation (`student-results.ts`). Results stay on screen for six hours.
- **Limit:** the hub lives in one server process. Running more than one instance would need a shared channel (for example Postgres LISTEN/NOTIFY) behind the same publish/subscribe functions.

## Live classroom (canvas, copilot, concept map)

The lesson page is a canvas-first workspace: a sticky bar holds the step list and a command bar (**Copilot**, **Concept map**, **Projector**). The copilot opens in a drawer (`RailDrawer`) so it never covers the lesson.

- **Session state machine:** `modules/lessons/run-machine.ts` is the only place that decides which events are allowed (`not_started → teaching → checking → needs_wrap → done`). `run.service.ts` calls `guard()` before start-check, finish-check and wrap; a repeated event is a no-op, an impossible one is a 409. "Paused" is deliberately not modelled: nothing in the product needs it yet and an unused state would be untestable.
- **Interactive canvas (`client/src/features/canvas/`):** `fraction-model.ts` is pure logic (validation, equivalence by cross-multiplication, scaling, simplification, step text, practice/challenge items, reducer with undo/reset). `FractionCanvas` renders it as bars and circles with a "focus the class" spotlight, and reuses the same component large on the projector (`large`). It exists for Equivalent fractions only. Its state is kept in `sessionStorage` for the tab (screen preference, never a student record).
- **Copilot (`modules/lessons/copilot.ts`, `copilot.service.ts`):** `GET /classes/:c/lessons/:l/run/copilot` builds suggestions from recorded facts with deterministic rules. Every suggestion carries a reason, its evidence lines, a certainty (`low|medium|high`) and an optional action. With too few answers it says "not enough information" and offers nothing else. Error patterns never exceed `medium` certainty. Actions are: preview an approved resource, preview a question, launch a prerequisite check (real `run/check/start`), or **prepare an AI draft**. The AI action appears only when the provider is available; the draft is saved as a private `ai_draft` resource that needs teacher approval, and a failure leaves nothing behind.
- **Run history:** `GET .../run/history` reads the audit log for the lesson and its check (started, check created/opened/closed, results shown, recorded as taught, wrapped up). The wrap-up page shows it, so a reloaded session still explains itself.
- **Concept map (`/classes/:c/concept-map`):** the approved prerequisite graph for a chapter, laid out left to right (`conceptMapModel.placeNodes`), with each node's class evidence counts from the learning map. The detail panel shows what the concept builds on and leads to, the evidence behind its status, provisional patterns, and follow-ups with reasons. `?lesson=&step=` lets "Back to the lesson" restore the step.
- **Limits:** the canvas covers one concept; activities are the diagnostic check and the quick poll (below); there is no short-answer activity yet; a copilot-prepared draft is reviewed on the drafts page rather than launched into the live lesson; copilot thresholds reuse `RECOMMENDATION_RULES` and are unvalidated.

## Quick polls (`modules/polls/`)

A one-question pulse of the class during a lesson, opened from **Quick poll** in the lesson's command bar. Three kinds: *How sure are you?* (fixed, gentle wording), *True or false* (the teacher's statement) and *Pick one* (two to four of the teacher's choices).

- **Not an assessment.** Polls live in their own tables (`class_polls`, `poll_votes`) so the evidence, review and mastery code cannot read them. A poll is never scored and never changes a student's learning record.
- **Counts only for the teacher.** `poll_votes` keeps the student id only to allow one answer per student; no teacher-facing query selects it. With a small class, counts can still hint at who chose what, so this is "not shown", not true anonymity.
- **One thing at a time.** One open poll per class (partial unique index). A poll cannot open while a check is open, and starting a check closes an open poll. Students can join the class while a poll is open.
- **Routes:** `POST /classes/:c/lessons/:l/polls`, `GET .../polls/current` (open poll, else the last closed one for the lesson), `POST /polls/:id/close` (closing twice is harmless). Students: `/student/activity` returns `state: "poll"` with the question and choices only; `POST /student/poll/vote` keeps the first answer, so a retry cannot count twice. Start and close are audited.
- **Live:** new signals `poll_opened`, `poll_closed` (also sent to students) and `poll_vote` (teacher only).

## Information architecture (redesign)

Signed-in pages share one shell (`client/src/app/Layout.tsx`): wordmark, a pill navigation bar with **Today · Classes · Lessons · Assessments · Insights · Misconception Atlas · Offline**, the sync state, a bell with the real "needs you" count, a user menu, and a one-tap return to a lesson that is running now. Each destination answers one teacher question:

- **Today** (`/`): greeting and three counts (students, periods today, things that need you); Students Overview (the focus class's roster as cards: latest concept, recorded answers, concepts that read as secure, growth label if a rule applies; roster order, never ranked); Learning Progress Distribution; book progress gauge; Lessons (today's next lesson and the next one, each with its single next action); Needs you (four fixed counts linking to the work); Today's periods; the week's Mathematics lessons with previous/next week (`GET /dashboard?week=YYYY-MM-DD`). Earlier days show the lessons actually run that day (from `lesson_runs`); later days are planned by the pacing rule.
- **Classes** (`/classes`): every class with roster size, join code, today's periods and routes into roster, timetable, class map, Insights and Atlas; class creation lives here.
- **Assessments** (`/assessments`, `GET /assessments`): every class check across classes with status, questions and submissions, filterable, linking to results and paper sheets.
- **Insights** (`/insights`, `GET /classes/:id/insights`, `modules/insights/insights.service.ts`): distribution of student-and-concept pairs by mastery status (denominator stated), per-concept counts, change between the last two class checks, students with error patterns, and growth groups (`growth.ts`).
- **Misconception Atlas** (`/atlas`, `GET /classes/:id/atlas`, `modules/insights/atlas.service.ts`): a workspace per class (Detect, Verify, Understand, Intervene, Recheck, Track) plus the existing pattern library as a second tab.

Insights, the Atlas, the class map and student history all read the same evidence ledger and mastery records, so their numbers agree.
