# Adhyaapak

A teacher-first adaptive classroom intelligence platform for Classes 6–10 (Code Kernel '26). It helps teachers see what each student understands, find likely misconceptions, group students for the next activity, and check whether the teaching worked. AI assists; the teacher decides.

Project brief: [CLAUDE.md](CLAUDE.md) · Build plan: [phases.md](phases.md) · Decisions: [docs/DECISIONS.md](docs/DECISIONS.md) · Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Status

Phases 0–4 are done: sign-in, classes and rosters, the Class 6 Fractions curriculum, the learning engines, and the full classroom loop. Phases 7 to 9 are done: an offline classroom pack with a safe sync queue (and a conflict inbox), Tomorrow's Teaching Brief with a revisit queue and a family home note, the optional student portal (a next step with a reason, short practice, a hint ladder), a second chapter (Decimals) and a Hindi proof of concept added as data, the misconception atlas, correction and erasure of student records, and a security and load review. Phase 6 is done for multiple-choice answer sheets: photograph a sheet, let the AI read it (or enter answers yourself), compare with the photo, and approve; nothing counts until you approve. Phase 5 is done: AI-drafted questions and explanations with deterministic checks and a teacher review screen, and syllabus upload to a reviewed, published concept graph (nothing AI-made is used until a teacher approves it). Visual design (Phase 10) is the remaining phase: the screens work but are deliberately plain.

## Requirements

- Node.js 22+
- Docker (for PostgreSQL)

## First-time setup

```bash
npm install
cp .env.example .env        # then edit .env
```

In `.env`, set at least:
- `SESSION_SECRET` — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `MESH_API_KEY` — only needed for AI features (Phase 5 onward); the app runs without it

```bash
npm run db:up               # starts PostgreSQL in Docker on host port 5433
npm run db:migrate          # creates the tables
npm run db:seed             # loads the Class 6 Fractions chapter (safe to re-run)
npm run dev                 # server on :4000, client on :5173
```

Open http://localhost:5173, create a teacher account, create a class, add or import students, and browse the Curriculum.

### Use the AI drafting (optional)

Set `MESH_API_KEY` in `.env` (and leave `AI_ENABLED=true`), then open a concept in the Curriculum and choose **AI drafts and review**. Ask for draft questions or an explanation; our code checks what it can, and you edit and approve. Nothing reaches students until you approve it. Without a key the page says AI is off and everything else works. Details and honest results: [docs/AI-WORKFLOWS.md](docs/AI-WORKFLOWS.md).

### Teach a lesson

From the class page, **Coverage** lists the chapter's concepts. Open one to get the lesson plan (starter, teach, quick check, practise, exit ticket), switch the teaching level for each part, see private class insight, print a worksheet or the teacher answer key, and mark the concept taught. **Present on a projector** opens a clean full-screen view with teaching content only (arrow keys to move, 1/2/3 to change level, Esc to leave).

### Try a classroom diagnostic

1. On the class page choose **New diagnostic or Prerequisite Pulse**, pick a concept, review the suggested questions and create the activity.
2. Click **Approve these questions**, then **Open for students**. The page shows the class join code.
3. On another device or tab, a student opens `/join`, types the join code and their roster number, and answers.
4. For paper answers, use the **Fast Entry Grid** on the same page (letters per question; `bs` = B and sure; `?` = unreadable).
5. Open the **learning map** to see statuses, select a cell for the "Why?" evidence, and review error patterns.

> Port 5433 is used on purpose: many Windows machines already have a native PostgreSQL on 5432.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Server and client together |
| `npm run db:up` / `db:migrate` | Start the database / apply migrations |
| `npm run typecheck` | Type-check all packages |
| `npm test` | Run server and client tests (see [docs/TESTING.md](docs/TESTING.md)) |
| `npm run db:generate -w server` | Create a migration after editing `server/src/db/schema.ts` |
| `npm run content:import -w server -- content/decimals-class6.json --dry-run` | Check (and with no flag, import) a content package; add `--approve` if reviewed |
| `npm run build -w client && npm run preview -w client` | Serve the production build with the service worker (port 4173) |

## Layout

```
shared/   Zod schemas and types used by both sides (evidence, mastery, recommendations, auth, errors)
server/   Express API  (src/modules/<feature>, src/http, src/db)
client/   React + Vite app (src/features/<feature>, src/services/api.ts, src/i18n)
docs/     Decisions, architecture, testing
```

## Configuration

All settings come from `.env` (see `.env.example`). The product name is `APP_NAME` (default `Adhyaapak`). Uploads are stored privately under `UPLOAD_STORAGE_PATH` (default `./storage`, git-ignored) with a size limit of `MAX_UPLOAD_SIZE_MB` (default 10). Photographed answer sheets are deleted `PAPER_RETENTION_DAYS` (default 30) after approval. Never commit `.env`.

## Reset the dev database

Questions and explanations now record who authored them, so clearing users also clears the curriculum. To start fresh:

```bash
docker exec adhyaapak-db-1 psql -U adhyaapak -d adhyaapak -c "truncate users, subjects cascade"
npm run db:seed
```

### Demo activity (optional)

With the API running, `npm run db:seed-demo -w server` signs in as the demo account from `.env` (`DEMO_LOGIN_EMAIL`/`DEMO_LOGIN_PASSWORD`) and runs a few class checks through the normal API, so Today, Insights and the Atlas have something to show. Every check it creates is titled "Demo data: …"; it touches no other account and refuses to run twice for the same class.
