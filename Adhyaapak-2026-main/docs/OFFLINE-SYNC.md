# Offline classroom pack and synchronisation

Code: `server/src/modules/offline/`, `client/src/features/offline/`, `client/public/sw.js`.

The aim is narrow and honest: a teacher can **teach a prepared lesson and record a class's answers with no connection**, then **save those records to the server once, safely**. It is not an offline copy of the application.

## What works offline, and what does not

| Works offline | Needs a connection |
|---|---|
| Opening the app (the shell is cached by the service worker) | Signing in the first time, and anything under `/api` |
| A lesson pack saved on the device: explanations in presentation mode, the check's questions, printable worksheet, response sheet and answer key | Marking and results, the learning map, recommendations, the teaching brief |
| Recording a class's answers into the on-device queue | AI drafts, syllabus processing, reading photographed sheets |
| Seeing how much work is waiting, and what was refused | Saving records to the server (sync), resolving conflicts |

The pack and sync screens say this in plain words (`offlineNotes` in the pack), and AI features are never presented as offline-capable.

## Preparing a pack

`POST /api/v1/lessons/:conceptId/offline-packs { classId, questionCount }` builds a pack and stores nothing about students beyond roll numbers:

- it picks approved diagnostic questions (the same selector as the online diagnostic) and creates the check as an **approved, not-yet-opened activity** so answers recorded offline have somewhere to land. Preparing again for the same lesson reuses an unused check instead of piling up copies;
- the pack holds the presentation content (the same server whitelist the projector uses: no answers, no notes), the questions **without** answers, the roll numbers (no names), and a separate `answerKey` used only to print the teacher's key;
- `version` is a hash of the ordered question ids. Work is recorded against it.

The client saves the pack to IndexedDB after checking free space (`navigator.storage.estimate`). **"Check it is ready"** reports what is actually stored (lesson levels, questions, roll numbers), whether the app shell is cached, and free space, and counts the items ("pack ready: N items saved"). It reports the shell as **not** ready when it cannot confirm it.

## The service worker (`client/public/sw.js`)

Explicit and versioned. It caches: the app shell (`/`), the manifest, the icon, and exactly the hashed `/assets/*` files named by the built page. It **never** touches `/api`, so private data cannot end up in a shared cache and API failures stay visible. Navigations go to the network first and fall back to the cached shell, so updates arrive when online. Old caches are deleted on activate; bump `SHELL_VERSION` when the worker changes. It is registered only in a production build (`import.meta.env.PROD`), so development never serves stale code. To test offline behaviour: `npm run build -w client && npm run preview -w client` (port 4173, proxies `/api`).

A teacher who is already signed in can open saved packs when the server cannot be reached: the last signed-in user is remembered in `localStorage` (id, name, role, nothing else). The server never trusts it; every API request is still authenticated.

## The operation queue (`queue.ts`)

IndexedDB store `queue`. **Only operations of a defined type are queued**; today that is `record_responses` (`OPERATION_TYPES` in `shared/src/offline.ts`). Each operation carries:

| Field | Meaning |
|---|---|
| `idempotencyKey` | `op-<uuid>`, generated when the work is recorded. Retrying with the same key never creates a second record |
| `type` | one of `OPERATION_TYPES` |
| `baseVersion` | the pack version the work was recorded against |
| `recordedAt` | when it was recorded on the device; becomes the evidence's observation time |
| `payload` | `assessmentId`, `rosterNumber`, `responses[]`. **Roll number, never a name** |

Sync (`syncQueue`) sends pending operations oldest first in batches of 20. After each batch only operations the server **acknowledged** leave the queue. If the connection drops, or the tab closes, mid-way, nothing is lost and nothing is double-applied: unacknowledged operations are simply sent again and the server recognises their keys. States on the device: `pending`, and `rejected` (kept, with the reason, until the teacher dismisses it). Applied, duplicate and conflicted operations leave the queue (the server holds the record).

Syncing runs by itself on start, when the browser reports it is back online, and every 30 seconds while work is waiting. A failed sync marks the server as unreachable, because a browser only knows its network card is up. An **unsynced-work badge** is in the header of every screen ("2 unsynced", "Offline · 2 unsynced", "All synced", "1 needs attention").

## Server side (`sync.service.ts`)

`POST /api/v1/sync/operations { operations[≤50] }` decides each operation on its own, in order:

1. **Known key** → returns the original outcome, writes nothing (`duplicate`). Another user's key is refused.
2. **Rejected** (can never succeed): unknown activity or another teacher's, activity still a draft, no such roll number in the class, an answer for a question not in the activity. The reason is stored and shown.
3. **Conflict**, never merged silently:
   - `already_answered`: the server already has answers from that student for that activity (another source). Offline answers never overwrite them. Only **discard** is possible.
   - `pack_stale`: the activity's question set changed after the pack was prepared (`baseVersion` ≠ the server's current version). The teacher may **apply the answers whose questions are still in the activity** (only if the server holds nothing for that student), or discard.
4. Otherwise → the ordinary transactional attempt pipeline with source `offline_synced` and the original `recordedAt`.

`sync_operations.idempotency_key` is unique, and the attempt itself uses key `sync:<key>`, so two requests racing with the same key cannot both apply. Conflicts stay in the table with their payload until a teacher resolves them (`GET /sync/conflicts`, `POST /sync/conflicts/:id/resolve`), and `GET /sync/status` returns counts. Resolutions are audited.

## Tested

- Server (`offline.test.ts`, 13 tests): pack contents (no answers in student-facing parts, roll numbers only), reuse, privacy; applied once; the same key sent three times; an interrupted sync resent in full; unopened and closed activities; already-answered conflict that cannot be applied; stale-version conflict applied for the questions that remain; rejections with reasons; another teacher's operations and hijacked keys; request validation.
- Client (`queue.test.ts`, 10 tests with `fake-indexeddb`): durability across a reconnect, one record per key, partial failure mid-way and completion on the next run, a **lost reply** (server applied it, device never heard) coming back as a duplicate, refused work kept until dismissed, conflicts handed to the server's inbox, signed-out and server-error stops, overlapping syncs sharing one run.
- Real browser, production build: with the **API and the web server both stopped**, the page reloaded from the service worker, recorded two students' answers ("2 unsynced"), and after the servers came back it synced by itself: two attempts, five evidence rows, each once.

## Known limits

- Packs are for **teacher-led** use. Students do not use packs, and the student portal has no offline mode (its printable practice is the fallback).
- Only recording answers is queued. Roster edits, assessment editing and paper-photo review are online-only by design.
- Marking happens after sync. Offline, the teacher sees what was recorded, not results.
- Browser storage is not permanent or secure against device loss. The pack holds roll numbers only, but the **answer key** is in IndexedDB on the teacher's device. Sync before handing the device on or clearing browser data.
- The "remember me offline" user record is in `localStorage` and is cleared on sign-out.
- Camera card scanning (stretch) was not built; the Fast Entry Grid and this offline grid are the guaranteed paths.
- Browsers can evict IndexedDB under storage pressure. The pack screen warns when space is low but cannot prevent this.
