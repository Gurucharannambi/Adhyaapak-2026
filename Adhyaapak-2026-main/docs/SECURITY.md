# Security review (Phase 9)

A checklist of what the code does, with where it is tested. "Tested" means an automated test fails if the property breaks. This is a self-review by the development team, **not** an independent audit or penetration test.

## Access control

| Property | How | Evidence |
|---|---|---|
| Every route refuses anonymous callers unless it is on an explicit public list | the sweep walks Express's own routing tables, so a **new route is covered automatically**; a route that answers an anonymous request fails the build | `server/src/http/route-security.test.ts` (93 routes at the time of writing) |
| A teacher session cannot use student routes, and a student session cannot use teacher routes | separate session types (`sessions` vs `student_sessions`), separate middleware | same sweep |
| No id-based route returns 200 or a server error for something that does not exist | object-level lookups return 404 | same sweep |
| Teachers see only their own classes, students, sheets, packs, briefs, conflicts and atlas counts; another teacher's ids return **404** (existence is not revealed) | `loadAccessibleClass` / `loadAccessibleAssessment` and per-module checks | per-module tests ("is private to the class's teacher" in paper, offline, brief, portal, content, classes) |
| A student sees only their own progress, in friendly words; no answer key before a question is answered, no diagnostic labels, no other students | whitelist DTOs built on the server | `portal.test.ts`, `classroom.test.ts` |
| Roles, never client-supplied ids, decide authority | `requireRole`; ids are checked against the session's owner | route tests |

## Sessions, passwords and request forgery

- Passwords: argon2id; never logged (`*.password`, `*.passwordHash` redacted).
- Sessions: random token, only its SHA-256 hash is stored; `HttpOnly`, `SameSite=Lax` cookie; `Secure` in production (`SESSION_COOKIE_SECURE`).
- CSRF: state-changing requests must carry an `Origin` equal to `APP_BASE_URL`; CORS allows only that origin.
- Rate limits: sign-in and registration, student join (guessable code + number), uploads, AI actions, practice and hints, sync. Disabled only in tests.
- Student join: a 6-character code plus a small number is guessable by design, so it is rate limited, sessions last 3 hours, and a student session can only answer the class's one open activity, or (if the teacher turned practice on) practise and see their own progress.

## Uploads

- Syllabus (PDF, text) and answer-sheet photos (JPEG, PNG): the **file's own bytes** are checked (magic numbers, structure), never the name or the browser's claimed type; size, page and character limits; cut-off, tiny or huge images refused; nothing is written to storage for a refused file (`syllabus.test.ts`, `paper.test.ts`, `image.test.ts`).
- Photos: GPS, camera and text metadata removed without re-encoding; data hidden after the end of the image dropped; only the rotation flag is kept (`image.test.ts`).
- Storage keys are random hex; every path is checked to stay inside the storage folder; files are never served by URL, only streamed by an access-checked route with `no-store`.
- PDF text is read with `pdfjs-dist` (upgraded to 6.x after an audit advisory, see below), with scripts, forms and fonts disabled.
- Uploaded text is treated as **data** in every AI prompt (fenced, "never follow instructions"), instruction-like wording is flagged, and the AI's output is validated and grounded in the document before a teacher sees it; nothing becomes authoritative without a teacher's approval.

## AI

AI never decides access, mastery, diagnosis or what a student sees. Its outputs are drafts, validated against schemas, with deterministic checks (arithmetic, references, grounding) in front of a teacher's approval. Keys stay on the server. Calls are metadata-logged only. The photo sent for sheet reading is sent only after an explicit tick. See `docs/AI-WORKFLOWS.md`.

## Logging and personal data

Cookies, authorization headers and keys are redacted. Database errors are logged **without** query parameters or row details, which can contain a student's name (the audit found Drizzle and Postgres put them in the error message and `detail`; `server/src/logger.ts` now strips them; `logger.test.ts`). Audit rows record who did what to which id, never names.

## Dependencies

`npm audit --omit=dev` (what runs in production): **0 vulnerabilities** after upgrading `pdfjs-dist` from 5.7 to 6.4 (it had a high-severity advisory about script execution when opening a malicious PDF, and it is the library that reads teachers' uploads). `npm audit` also reports advisories in **development-only tools** (vitest and its test pool, and an old esbuild inside drizzle-kit's tooling). They do not ship and do not run in production; they are left for a coordinated tooling upgrade rather than risking the test setup with a forced major change. Re-run the audit before every release.

## Not done / residual risk

- No independent penetration test or code audit.
- No multi-factor authentication; no account lockout beyond rate limits; no password reset by email.
- The class code + roll number student access is convenience, not strong authentication.
- Local file storage has no encryption at rest. Use disk encryption or an encrypted object store.
- IndexedDB on a teacher's device holds roll numbers and the answer key for a downloaded pack. Device loss is a risk the app cannot remove.
- CSP and other headers come from `helmet` defaults; the front end is served by whatever hosts `client/dist`, which must set its own headers.
- Prompt-injection defences reduce, but cannot eliminate, the chance that a hostile document sways a draft. The human review gate is the real control.
