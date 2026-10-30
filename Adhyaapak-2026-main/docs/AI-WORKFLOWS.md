# AI workflows

Code: `server/src/modules/ai/`. AI in Adhyaapak is a **drafting aid**. It never decides a diagnosis, a mastery status, a permission or what a student sees. Everything it writes starts as a private draft, our code checks what it can, and a teacher approves before anything is used.

> Status: question and explanation drafting and syllabus → concept-graph generation are built and tested (including live runs against Mesh).

## Provider adapter (`mesh-provider.ts`, `provider.ts`, `errors.ts`, `rate-limiter.ts`)

Everything else in the app depends on the small `LlmProvider` interface, never on Mesh or LangChain directly, so features can be tested with a fake (`server/src/test/scripted-provider.ts`) and run with AI off.

- **Mesh** is OpenAI-compatible. The adapter uses LangChain JS's `ChatOpenAI` with `baseURL` set to Mesh (`@langchain/openai` 1.8, `@langchain/core` 1.3). Verified live: strict JSON-schema output and function calling both work with `openai/gpt-4o-mini` (model is `MESH_API_MODEL`).
- **Structured output**: temperature 0, JSON-schema mode, then our own Zod validation of the result. Nothing unvalidated is ever returned.
- **Timeout** per attempt (`MESH_API_TIMEOUT_MS`). **Retries** (`MESH_API_MAX_RETRIES`) only for failures that can succeed later: timeouts, 429 (honouring `Retry-After`), 5xx and network errors, with exponential backoff and jitter. Never for 400/401/402/403/422. Unusable output gets exactly one extra try.
- **Client-side rate limit** of 80 requests a minute, under Mesh's default of 100 per key. Each teacher also has a small allowance of generate calls (20 per 10 minutes).
- **Safe errors**: the provider's own message never reaches a browser or a log. Callers see a short friendly message per failure kind (turned off, too slow, busy, bad output, account problem).
- **Logging**: workflow name, model, prompt version, duration, attempts, status and the provider's request id. No prompts, no responses, no keys, no student data. Every call is also recorded in the `ai_runs` table (same metadata only).
- **Off switch**: `AI_ENABLED=false` or a missing `MESH_API_KEY` gives an `UnavailableProvider`. Drafting then says so plainly and the rest of the product is unchanged.

## Workflow: question drafts (`drafts.service.ts`, prompt `question-draft-2`)

1. **Input is our own data**: the concept, its prerequisites, the approved misconception rules (with their exact keys) and the existing questions (so they are not repeated). Nothing user-uploaded and no student data is sent. The prompt fences this in `<data>` tags and states that it is information, not instructions.
2. **Output** (loose schema; the strict provider mode rejects length and range keywords): stem, difficulty, four options each with an optional misconception key, the correct index and an explanation.
3. **Deterministic checks** before anything is saved:
   - exactly 4 options, valid correct index, difficulty 1–5, length limits, no HTML or markdown;
   - the shared question validator (unique options, correct option not tagged);
   - every misconception key must be a real approved rule (the model's text `"null"`/`"none"` is treated as no tag);
   - no repeat of an existing question, or of another draft in the same batch;
   - **arithmetic verification** (`verify-arithmetic.ts`) for the question shapes we can check exactly: `a/b ± c/d = ?`, `Which is greater/smaller: a/b or c/d?` and `Which fraction is (NOT) equivalent to a/b?`. It checks the marked answer, that no other option is also correct, and that a wrong option tagged with an error pattern really is what that mistake produces. The same verifier agrees with every applicable question in the hand-written seed bank (and caught a real mis-tag there).
4. Drafts that fail are **discarded and not saved**; the teacher sees why. The rest are saved as `draft` with `provenance.source = "ai_draft"` and an automatic-check note.
5. At most 6 pending question drafts per teacher per concept, so review keeps up and cost stays bounded.

## Workflow: explanation drafts (prompt `explanation-draft-1`)

Same pattern, one draft per level per teacher at a time. Checks: required parts for the level (foundation needs two or more steps, guided needs a worked example, challenge needs a task), length limits, no markup. Explanations are never auto-verified.

## Workflow: syllabus → concept graph (`server/src/modules/syllabus/`, prompt `syllabus-graph-1`)

1. **Upload** (PDF, text, or pasted text). Magic bytes must match the extension, text must be UTF-8 without NUL bytes, limits are 10 MB / 60 pages / 24,000 characters. PDF text is read with `pdfjs-dist` (no XFA, no font programs); scanned PDFs are refused rather than guessed at. The original is kept in private storage under a random key (never a URL); identical content is de-duplicated by hash.
2. **Generate** (teacher action, max 3 drafts per document). The document goes into the prompt inside a `<document>` fence with an instruction to treat it as data. The provider returns loose JSON, which we validate ourselves.
3. **`buildProposal`** (deterministic): strips markup, enforces caps (25 concepts, 60 prerequisites), drops unknown/self/duplicate edges, breaks loops by removing the weakest edge, and decides what is "grounded". A prerequisite is grounded only if its quote really occurs in the document **and** mentions both concepts (by distinctive word stems; words shared by most concepts do not count). Ungrounded or low-confidence edges start `pending`.
4. **Injection wording** in the document is detected and shown as a warning; it never blocks the teacher and never changes what the code does.
5. **Review**: the teacher edits concepts, accepts or rejects each prerequisite, can add their own. Publishing needs no pending edge, no loop and an explicit confirmation, and creates a **new** curriculum version (provenance `teacher_upload`). Nothing is published automatically.

Live results: a real 2-page PDF gave 7 concepts and 5 document-quoted prerequisites. A hostile document was flagged and the model did not obey it; its off-topic quotes were caught by the "must mention both concepts" rule and became pending. New concepts have no questions; use AI drafts and review next.

## Workflow: paper sheets (`server/src/modules/paper/`, prompt `sheet-reading-1`)

Reading and judging are kept apart. The reader only reports what is marked; the ordinary deterministic answer check judges it, and only after a teacher approves.

1. **Upload** (teacher, one JPEG/PNG per student per activity; the activity must be open or closed). Bytes are checked as a real image (the name and browser type are not trusted); cut-off or tiny/huge pictures are refused. Metadata is removed without re-encoding the pixels (JPEG: all APPn and comment segments, data after the end marker; PNG: text, time and EXIF chunks), keeping only the camera rotation flag. The photo is stored privately under a random key and is only streamed to the class's teacher with no-store headers.
2. **Read** (optional, explicit): the teacher ticks that the photo will be sent to the AI service. The prompt lists questions with lettered options and never the answer key; the photo is treated as data. Output is validated, then `interpretMarks` maps it deterministically: letters to options, a written answer only if it exactly matches a printed option, and anything missing, doubled, out of range or ambiguous becomes "unreadable". Legibility ("clear / unsure / unreadable") is the model's own statement, not a calibrated probability. If reading fails or AI is off, the teacher enters answers by hand from the photo.
3. **Review** (side by side). Any answer not read clearly, or never read, needs the teacher's own choice. Changing a reading counts as the teacher's decision.
4. **Approve** goes through `submitAttempt` with source `paper_reviewed` and key `paper:<sheet id>`: transactional and idempotent. Blank and unreadable answers are stored as "insufficient evidence", never "wrong". Nothing before approval touches evidence or mastery. Rejecting deletes the photo at once.
5. **Retention**: approved photos are deleted `PAPER_RETENTION_DAYS` (default 30) after approval by an hourly sweep; the teacher can delete a photo any time. Answers stay in the record.
6. **Accuracy log** (`GET /paper-accuracy`): of the answers the reader produced, how many the teacher changed. It measures the reader, not students.

Printable answer sheets (`/activities/:id/print-sheets`) carry the roll number, not the name, with one boxed letter per question.

Live results (`openai/gpt-4o-mini` through Mesh, 5 synthetic sheets of 4 answers each rendered with handwriting-style fonts: clean, struck-out answer, two letters, faint and rotated with noise, written-out answers): 17 of 20 answers exactly right, 3 conservatively "unreadable" (a struck-out-then-replaced answer, "A or C", and a lowercase "b" it was unsure was an answer), and no confidently wrong answer. This is **not** evidence about real children's handwriting or phone photos, which will be harder; the review gate and the accuracy log exist for that reason. Each read took about 2 seconds.

## Review

Drafts are visible and editable only by their author (admins can see all). Editing re-runs the checks. To approve:

- a draft whose checks **failed** cannot be approved at all;
- a draft the code **could not verify** (other question shapes, and all explanations) can be approved only if the teacher confirms they checked it by hand (`checkedByHand`);
- a **verified** question can be approved directly.

Approving sets `approved`, records who and when, and keeps the `ai_draft` provenance. Rejecting keeps the row but hides it. Approved questions join the shared bank and are used by suggestions and assessments; approved explanations replace what is *shown* at that level (the newest approved one wins) while older text stays in the database. Drafts never appear in the concept page, lesson workspace, presentation mode, question suggestions or new activities.

## What the live model actually did (honest numbers)

Runs against `openai/gpt-4o-mini` through the real endpoint, with the checks above:

| Concept | Drafts asked | Saved | Thrown away by checks |
|---|---|---|---|
| Adding fractions | 3 + 3 | 0 | all (wrong tags, duplicate options, a second correct answer) |
| Subtracting fractions | 3 + 3 | 0 | all (it wrote the text "null" as a tag; wrong answers) |
| Comparing fractions | 6 | 5 | 1 (marked the wrong fraction). One of the first three, "4/6 vs 2/3", was wrong (the fractions are equal) and led to the comparison check |
| Equivalent fractions | 9 (+2 from the screen) | 5 | 4 caught after the equivalence check was added (two correct options, bad tags). The 3 saved *before* it existed included two wrong ones; of the later saves, some are only "check by hand" |

Takeaways: this model is **weak at writing arithmetic multiple-choice questions with correct distractors**, and unreliable at tagging them. Without the deterministic checks most drafts would have been wrong. It is better at explanations and at simple comparison items. Question shapes the verifier does not cover (for example "6/9 in simplest form", "3/4 multiplied by 2") are saved only as "check by hand", and one such draft had a wrong answer, which is exactly why those need the teacher's confirmation. A stronger model on Mesh may do better; switching is a one-line config change (`MESH_API_MODEL`).

## Limitations

- Verification only covers three fraction question shapes. Everything else relies on the teacher.
- No response cache: a drafted item is stored as a draft, and per-concept caps bound repeat calls.
- Prompt-injection defences are fenced prompts, output validation, quote grounding and a human publish gate. They reduce risk; they do not prove a document cannot sway the model.
- Paper: only multiple-choice sheets (option letters or exact option text) are read; free-working and handwritten maths steps are not. PDFs and HEIC are not accepted. The photo goes to the AI provider whenever a teacher chooses AI reading, so names should not be on it.
- Syllabus: grounding shows a quote exists and names both concepts, not that it proves the dependency. Published curricula are global to the installation.
- Costs are small (a draft call is a few seconds and fractions of a cent) but are only visible through the `ai_runs` table, not yet on a screen.
