# Deployment requirements and data handling

For a school or a pilot that wants to run Adhyaapak. This describes what the code needs and what it does with children's data. It is not a legal compliance statement: schools must check these against their own obligations (for example India's DPDP Act, 2023, and the rules for children's data) and their board's guidance.

## What to run

| Part | Requirement |
|---|---|
| Server | Node.js 22+, one process (`npm run build` is not needed for the server; it runs with `tsx`, or compile with `tsc` for a stricter setup) |
| Database | PostgreSQL 16. All migrations are in `server/drizzle/`; apply with `npm run db:migrate -w server` |
| Web app | `npm run build -w client`; serve `client/dist` as static files from the **same origin** as the API (`/api` proxied to the server). The service worker needs HTTPS in production (localhost is exempt) |
| File storage | A private folder (`UPLOAD_STORAGE_PATH`) on a disk that is **not** web-served, or a private object store behind the `StorageProvider` interface (`server/src/modules/files/storage.ts`). There are no public file URLs |
| Reverse proxy | TLS termination. Set `NODE_ENV=production` (trusts one proxy hop for client IPs), `SESSION_COOKIE_SECURE=true`, and `APP_BASE_URL` to the public address (it is also the only allowed `Origin` for state-changing requests) |
| AI (optional) | `MESH_API_KEY`. The app works with AI off (`AI_ENABLED=false`): drafts, syllabus processing and sheet reading are then unavailable, everything else works |

Configuration is in `.env` (see `.env.example`). Never commit it. `SESSION_SECRET` must be at least 16 random characters. Rate limits are on by default (`RATE_LIMIT_ENABLED`).

## First start

1. `npm run db:up` (or your own PostgreSQL), set `DATABASE_URL`.
2. `npm run db:migrate -w server`, then `npm run db:seed -w server` for the Class 6 Fractions chapter.
3. Optional content: `npm run content:import -w server -- content/decimals-class6.json --approve` (see below).
4. Start the server; check `GET /api/v1/health`.

## Adding content (no code changes)

Content packages are JSON (`server/content/*.json`, shape in `server/src/modules/curriculum/content/package.ts`). The importer checks everything first (references, loops, all three explanation levels, question validity, and the arithmetic of fraction and decimal questions) and writes nothing if there is a single error.

```
npm run content:import -w server -- content/decimals-class6.json --dry-run   # check only
npm run content:import -w server -- content/decimals-class6.json             # import as drafts
npm run content:import -w server -- content/decimals-class6.json --approve    # author attests it was reviewed
```

Without `--approve`, concepts, questions and misconceptions arrive as **drafts** and are not shown to students or usable in assessments until approved. **Translations always arrive as drafts.** Re-running is harmless: existing keys are never overwritten. The importer is a command-line tool on purpose: published curricula are visible to every teacher on an installation, so adding one is an administrator's decision.

## What data is stored, and who can see it

| Data | Where | Who can read it |
|---|---|---|
| Teacher name, email, password hash (argon2id) | `users` | the teacher; admin role |
| Student name, optional reference id, roll number | `student_profiles`, `class_enrolments` | that class's teacher only (object-level checks on every route) |
| Answers and learning evidence | `question_responses`, `assessment_evidence`, `concept_mastery` | the class's teacher; a student sees only their own friendly progress words |
| Photographed answer sheets | private storage, deleted by retention | the class's teacher only; streamed with `Cache-Control: no-store` |
| Syllabus documents | private storage | the uploading teacher |
| Teaching briefs, offline pack records, sync operations | tables | the class's teacher |
| Audit log | `audit_log` | append-only; actor ids are not foreign keys so rows outlive users |
| AI call metadata | `ai_runs` | metadata only (workflow, model, duration). No prompts, responses or student data |

### What leaves the installation

Only when a teacher chooses an AI action, and only the minimum for that task, to the configured Mesh API endpoint:

- question and explanation drafts: concept titles and learning objectives (no student data);
- syllabus graphs: the text of the document the teacher uploaded (untrusted data, fenced in the prompt);
- reading a photographed sheet: **the photo**, after the teacher ticks that it is sent to the AI service. Metadata is removed first, but the image itself can contain whatever is written on the paper, so students are told not to write names on sheets.

Nothing else is sent: no rosters, no learning records. If your arrangement with the AI provider does not permit student work to be processed, set `AI_ENABLED=false`, or tell teachers not to use sheet reading (the teacher can enter answers by hand from the photo).

### Retention and deletion

- **Photographed sheets**: deleted automatically `PAPER_RETENTION_DAYS` (default 30) after approval; deleted at once when rejected; the teacher can delete a photo at any time. An hourly sweep in `server.ts` does the automatic deletion.
- **Sessions**: student sessions last 3 hours, teacher sessions `SESSION_TTL_HOURS`; expired ones are swept hourly.
- **Correcting a record**: a teacher can fix a student's name, reference and roll number (`PATCH /classes/:id/students/:studentId`).
- **Removing a student's personal details** (`POST .../erase`, typed confirmation): name, reference id, sign-in sessions and photographed sheets are removed. The answers stay in the evidence ledger **without a name**, because the ledger is append-only and class results depend on it. This anonymises; it does not hard-delete answers.
- **Hard deletion of a student's answers** is an administrator database operation, because the ledger is deliberately immutable. If a school's policy requires it, run it in a transaction against the test copy first: delete the student's rows from `assessment_evidence` (via their `question_responses`), `misconception_observations`, `concept_mastery`, `interventions`, `question_responses`, `assessment_attempts`, then recompute class mastery (`recomputeAllMastery`). Take a backup first.
- **Backups** contain everything above. Treat them as personal data: encrypt them and apply the same retention.

## Logging

Structured JSON (pino). Cookies, authorization headers and keys are redacted. Database errors are logged **without** query parameters or row details (they can contain a child's name); see `server/src/logger.ts` and its test. Request logs carry URLs with opaque ids, not names. Set `LOG_LEVEL` appropriately and rotate logs.

## Security checklist before a pilot

See `docs/SECURITY.md`. At minimum: HTTPS, `SESSION_COOKIE_SECURE=true`, a strong `SESSION_SECRET`, a private `UPLOAD_STORAGE_PATH`, database not exposed to the internet, `npm audit --omit=dev` clean, backups encrypted, and a named person responsible for deletion requests.

## Honest limitations

- One installation, one school/region assumed. Published curricula are shared by every teacher on it. There is no per-school content partitioning or per-school administrator interface yet.
- No email: there is no password reset flow. An administrator resets a password in the database.
- The local file storage driver is for a single server. Several servers need the object-store driver (not written).
- The student portal and join flow depend on a class code plus a roll number, which is guessable by design (a small, friendly secret). Joins are rate limited and sessions are short, but this is not authentication for sensitive data; the portal exposes only that student's own friendly progress.
- Not load-tested beyond a 40-student class (see below). Not penetration-tested by a third party.
- Data-protection compliance (consent from parents, notices, a data-protection officer, children's-data rules) is the school's responsibility and is **not** implemented in the application.
