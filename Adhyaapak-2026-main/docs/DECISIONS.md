# Adhyaapak — Phase 0 Decisions Record

Status of each decision: **Decided** (made, building on it), **Recommended** (my proposal, change freely before Phase 1 ends), **Pending** (needs input or a key).
Last updated: Phase 0.

## 1. Environment (verified on this machine)

| Tool | State |
|---|---|
| Node.js 22.16, npm 10.9 | Installed |
| Docker 29.3 | Installed → used for local PostgreSQL |
| PostgreSQL / `psql` | **Not installed natively.** Use the Postgres container (docker-compose, added in Phase 1) |
| Git 2.50 | Installed, but the folder is **not yet a git repository** |
| Python 3.11 | Installed (not needed by the stack) |

## 2. Mesh API (verified against developers.meshapi.ai, no key used yet)

**Decided:** model is `openai/gpt-4o-mini` (team decision) for both text and, if the smoke test passes, vision.

Verified facts:
- Base URL `https://api.meshapi.ai/v1`, OpenAI-compatible. Auth is `Authorization: Bearer rsk_...` (Router Service Key).
- Model IDs use `provider/model`. `GET /v1/models` lists models with `supports_structured_output` and `input_modalities` flags (needs a key).
- Structured output: `response_format: { type: "json_schema", json_schema: { name, schema } }` with `additionalProperties: false`. Result is a JSON **string** in `choices[0].message.content` that we must parse and validate ourselves. Docs say OpenAI models have first-class support; `temperature: 0` gives the most schema-faithful output. The docs do **not** define a `strict` field. Some models silently ignore `response_format` and return prose, so we always validate.
- Vision: `image_url` content parts, either https URL or `data:` base64 URL. Docs recommend **base64** for compatibility. No size limits are documented.
- Errors: envelope `{ error: { code, message, provider_code? }, request_id }`. Branch on `error.code`; always log `request_id`. Retry with backoff: `rate_limit_exceeded`, `upstream_rate_limit_error`, `gateway_timeout`, `upstream_error`, `upstream_overload`, `internal_error` (once). Do **not** retry unchanged: `context_window_exceeded`, `content_policy_violation`, `invalid_request`, `validation_error`. Account problems (`insufficient_credits`, `spend_limit_exceeded`, `invalid_api_key`) surface as a clear "AI unavailable" state.
- Rate limits per key default: **100 requests/minute, 10,000/day**. Headers `x-ratelimit-*-requests`; 429 includes `Retry-After`. Our adapter must queue/limit client-side and cache non-personal generations.
- LangChain: Mesh docs say use `ChatOpenAI` with `base_url`/`api_key`; the page only shows Python. **No Mesh-specific package is needed.**

**Smoke test results (run in Phase 1 with the team key, raw HTTP):**
- `GET /v1/models/openai%2Fgpt-4o-mini` → 200. `supports_structured_output: true`, `input_modalities: ["text","image"]`, `supports_tools: true`, context 128k. Price: $0.15 / 1M input tokens, $0.60 / 1M output tokens.
- Structured output (`json_schema`, `temperature: 0`) → 200 in ~1.5 s, valid JSON, parsed and matched the schema. `x-ratelimit-limit-requests: 100`.
- Vision with a base64 PNG → 200 in ~1.4 s. A **typed-font** image of `1/2 + 1/3 = 2/5` was transcribed exactly. This says nothing yet about real handwriting; that is the Phase 6 spike.
- **Important finding:** asked to classify `1/2 + 1/3 = 2/5`, the model returned `outcome: "arithmetic"` while its own reason text described the "added without a common denominator" misconception. The label and the explanation disagreed. This is concrete evidence for our rule: **the LLM never decides diagnoses; deterministic rules do, and AI output is only a draft.**

**LangChain JS verified (Phase 5):** `@langchain/openai` 1.8 + `@langchain/core` 1.3, `new ChatOpenAI({ model, apiKey, configuration: { baseURL } })` with `withStructuredOutput(zodSchema, { method: "jsonSchema" })` works against Mesh with `openai/gpt-4o-mini` (about 1.2–1.5 s). `functionCalling` also works; `jsonMode` fails unless the prompt contains the word "json", so it is not used. Strict schema mode rejects length/range keywords, so those limits are enforced by our own validation. See [AI-WORKFLOWS.md](AI-WORKFLOWS.md).

Was unverified until Phase 5 (now resolved above, except handwriting quality which remains a Phase 6 spike): LangChain **JS** `ChatOpenAI` with a custom `baseURL` and `withStructuredOutput` against Mesh; handwriting quality (Phase 6).

The key lives only in `.env` (git-ignored). Set a `spend_cap_usd` on it in the Mesh dashboard.

Package versions found on npm today: `langchain` 1.6.0, `@langchain/core` 1.3.1, `@langchain/openai` 1.8.0. Pin exact versions in Phase 5 after the smoke test.

## 3. Stack choices

| Area | Decision | Status | Why |
|---|---|---|---|
| Repo layout | npm workspaces: `shared/`, `client/`, `server/` | Decided | One install, shared types, simple for a student team. `shared/` exists now; `client/` and `server/` arrive in Phase 1 |
| Language | TypeScript everywhere, strict | Decided | CLAUDE.md §8 |
| Client | React 19 + Vite + React Router + react-i18next | Decided | CLAUDE.md §8, principle 11 |
| Server | Express (v5 is current) + TypeScript, `tsx` in dev | Recommended | Required by CLAUDE.md; v5 handles async errors natively |
| Validation | **Zod** (v4), schemas shared between client and server | Decided | Already used in `shared/`; the same schema validates requests, AI output and forms |
| Database | PostgreSQL 16+ via Docker | Decided | CLAUDE.md §8 |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | Recommended | SQL-close and typed, so CHECK constraints, partial unique indexes and explicit transactions (all required by §10) are easy to express. Alternative: Prisma, friendlier to beginners but weaker on constraints. |
| Auth | Server-side sessions in Postgres, HttpOnly SameSite cookie, argon2 password hashing (`@node-rs/argon2`) | Recommended | §14: no tokens in browser storage |
| Testing | Vitest (unit + integration), Playwright for the one end-to-end flow | Recommended | Same runner for client and server |
| Charts / graph | Charting: Recharts. Graph: React Flow with dagre layout | Recommended, revisit in Phase 4/5 | React Flow supports editing nodes/edges, which the graph editor needs |
| PDF text extraction | `pdfjs-dist` on the server | Recommended | Pure JS; scanned PDFs return "could not extract, paste text" (see Phase 5) |
| Background jobs | In-process job table in Postgres with a polling worker (no Redis) | Recommended | Keeps the monolith simple; enough for syllabus processing and OCR |
| File storage | `StorageProvider` interface, local-disk driver in dev | Decided | CLAUDE.md §8 |

## 4. Product and content decisions

- **Product name:** Adhyaapak. Read from `APP_NAME` in config. **Decided.**
- **i18n:** all UI strings via react-i18next from day one, English only shipped first; content rows carry a `language`. **Decided.**
- **Seeded chapter:** Class 6 Mathematics, **Fractions**. Content (explanations, questions, distractors, misconception rules) is **authored originally**, aligned to the topic names in the official NCERT/CBSE syllabus only. Chapter numbering and exact topic list will be verified against the official syllabus PDF the day we write the seed (Phase 2). **Recommended.**
- **Concept chain for the seed** (illustrative until reviewed): multiplication facts → factors and multiples → fraction as part of a whole → equivalent fractions → comparing fractions → common denominator → adding fractions → subtracting fractions → fraction word problems.
- **Student access on shared devices:** teacher-started classroom sessions. The teacher opens a diagnostic and students answer by **join code + roster number** (no password, no personal data) for the in-class diagnostic; individual PIN accounts only for the optional portal in Phase 8. **Recommended**, because it needs no per-student setup and works on one shared phone/laptop.
- **Evidence confidence** is ordinal (`low / medium / high`), defined in `shared/src/evidence.ts`. **Decided.**
- **Camera card scanning spike:** desk research says feasible. `js-aruco2` (v2.0.0) is a maintained JS port of ArUco with multiple dictionaries; detection runs in the browser from a camera stream. Real risk is classroom lighting, distance and cards that are held at angles. **Verdict: attempt in Phase 7 as a stretch only after the Fast Entry Grid exists.** Not blocking anything. No further spike time spent now.
- **Demo hosting:** local run with Docker Postgres. Deployment is an open question for Phase 9–10. **Pending.**
- **Git:** not initialised yet. Run `git init` when you want version control; I haven't done it without being asked.

## 5. Contracts created in this phase

`shared/src` (type-checks cleanly with `npm run typecheck`):
- `common.ts` — IDs, roles, grades 6–10, language, `ReviewStatus` lifecycle, `Provenance`.
- `errors.ts` — API error envelope and the §15 error categories.
- `evidence.ts` — the evidence ledger row; `SelfConfidence`; and `canAffectMastery()`, the rule that unreviewed or low-confidence evidence cannot change mastery.
- `mastery.ts` — mastery statuses, the derived `ConceptMastery` record, and the `MasteryEstimator` interface.
- `diagnosis.ts` — the six §7 diagnosis outcomes.
- `recommendation.ts` — the Recommendation Contract.

Route-level request/response contracts (`/api/v1/...`) are defined per phase alongside their routes, starting with auth and classes in Phase 1/2, so we don't write schemas for code that doesn't exist yet.

## 6. Open items for you

1. Provide a Mesh API key (and set a spend cap) when we reach Phase 5, or sooner if you want me to run the smoke test.
2. Confirm or change the **recommended** choices above, mainly Drizzle vs Prisma and the join-code student session.
3. Decide when to `git init` (and where to host the remote, if any).
