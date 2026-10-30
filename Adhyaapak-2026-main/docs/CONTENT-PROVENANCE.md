# Content provenance

Every concept, resource, question and misconception pattern records where it came from (`provenance`) and whether a human has reviewed it (`review_status`: draft → reviewed → approved).

## Class 6 Mathematics — Fractions (seed)

- **Source:** original. Written by the Adhyaapak team. No textbook text, exercises or illustrations are copied (CLAUDE.md §2).
- **Alignment:** topic names follow the general scope of a Class 6 fractions chapter. The exact chapter number and topic list for a given board must be confirmed against that board's official syllabus before we claim alignment. The `board` field on the seed is currently "CBSE".
- **Review status:** seeded as `approved` so the demo works, but **no subject teacher has reviewed it yet**. Provenance notes say so. Have a maths teacher review the explanations, the answer keys and each wrong-option-to-misconception tag before real classroom use.
- **Misconception tags** are the team's pedagogical judgement, not research findings. We do not claim they are validated. Teacher confirm/reject tracking (Phase 3/4) is how we will measure how useful each one is.

## Content shapes

`learning_resources.content` is JSON by teaching level:
- foundation: `summary`, `steps[]`, optional `manipulative` (e.g. `{type: "fraction-bar", parts, shaded}`)
- guided: `summary`, `workedExample {problem, steps[]}`, `commonError`
- challenge: `summary`, `prompt`
- teacher note: `text`

AI-generated content (Phase 5) must enter as `draft` with `provenance.source = "ai_draft"` and cannot reach students until approved.

## AI-drafted content (Phase 5)

Questions and explanations drafted by the AI are stored with `provenance.source = "ai_draft"` and a note naming the model, the prompt version and the result of the automatic check. They start as `draft`, visible only to the teacher who asked for them. A teacher edits and approves them (reviewer and time are recorded); approval does not remove the AI provenance. Nothing the AI writes is shown to students, used in an assessment, or put on a projector until approved. The AI is given only our own concept and misconception data, never student information or uploaded text.

## Content packages (Phase 9)

`server/content/*.json` are content packages (format in `server/src/modules/curriculum/content/package.ts`). Each carries a `provenance` (`source` and a note) that is copied onto every concept, resource, question and misconception it creates.

- **Class 6 Mathematics: Decimals** (`decimals-class6.json`): six concepts (tenths and hundredths, place value, comparing, adding, decimals and fractions, money and measures), 21 questions, four misconception rules, original text and examples authored by the Adhyaapak team. The checker verified the arithmetic of 8 questions (sums, differences and comparisons); the others were checked by hand and **need review by a subject teacher before classroom use**. Prerequisites reach back into the Fractions chapter. Imported with `--approve` in development; without it, everything arrives as drafts.
- **Hindi proof of concept** (`fractions-hi-poc.json`): Hindi drafts of four explanations (fraction as part, adding fractions, foundation and guided levels), prepared with AI assistance. Numbers and notation are unchanged from the English. They are stored as `draft` with `source: ai_draft` and a note requiring review by a Hindi-medium mathematics teacher. Importing never approves a translation, even with `--approve`; they are visible to teachers only, side by side with the English, and never to students until approved.
- No textbook text, illustrations or board question banks were used or copied.
- A glossary of key terms per language was **not** built; terminology consistency is part of the human review of a translation.
