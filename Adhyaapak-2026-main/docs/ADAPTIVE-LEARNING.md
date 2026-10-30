# Adaptive learning: how it works and where it is weak

Code: `server/src/modules/learning/`. Every threshold below lives in `learning/config.ts`; nothing is hardcoded in logic. All five engines are deterministic: the same evidence and configuration always give the same output. None of them calls an LLM.

> **Read this first.** The numbers and thresholds are documented defaults and judgement calls. They have not been calibrated or validated against real students. Statuses are provisional labels for a teacher to check, not measurements of ability.

## The loop

```
response → evaluate → evidence row → rule match → diagnosis → mastery recompute → recommendation
```

`submitAttempt` (`persistence/attempt.service.ts`) does the first five steps in one database transaction, so a failure saves nothing. Retrying with the same idempotency key returns the original attempt. The recommendation step is a pure function called when the teacher views a student or class.

## 1. Concept graph (`graph/`)

Edge A → B means A is a prerequisite for B. `validateGraph` checks duplicates, self-edges, missing nodes and cycles (with the cycle path). `ConceptGraph` offers direct and transitive prerequisites (nearest first), dependents, a deterministic teaching sequence, and the path to a concept. Validity is never delegated to an LLM; Phase 5 will run AI-proposed graphs through the same checks.

## 2. Assessment (`assessment/`)

- `validateQuestion`: at least two unique options, correct option exists and is not tagged as a misconception, difficulty 1–5, no blanks.
- `evaluateResponse`: exact check. Blank, unreadable, an invalid option, or typed text matching no printed option all become **insufficient**, never **incorrect**.
- `selectDiagnosticQuestions`: 2–5 approved, valid, diagnostic-role questions, round-robin over the chosen concepts, preferring questions whose wrong options reveal a misconception. May return fewer than requested.
- `prerequisitePulse`: one easy question per direct prerequisite of a new topic.

A correct answer to a multi-concept question also credits its secondary concepts (as `also_assesses`, medium confidence). A wrong answer does not blame them.

## 3. Evidence

Each response creates rows in the append-only ledger (`assessment_evidence`): result, difficulty, self-confidence (sure / unsure / guess), source, confidence (low / medium / high, **ordinal, not a probability**) and review status. Only evidence that passes `canAffectMastery` (shared package) counts: not `insufficient`, not pending or rejected, and low-confidence only if a teacher approved it.

## 4. Misconception rules and diagnosis (`misconception/`)

Rules are validated data (`rules.ts`), never code. Trigger kinds: `distractor_option` (a wrong option tagged with the rule's key) and `answer_pattern` (typed text equals a listed pattern). Each rule has a category (conceptual, procedural, arithmetic, reading) that decides the outcome label.

`diagnose` enforces:

| Situation | Outcome |
|---|---|
| Correct answer | correct for the targeted skill |
| Blank, unreadable, pending review, or unapproved low-confidence | insufficient evidence, review required |
| Wrong, no known pattern | insufficient evidence (ask the student to explain) |
| Wrong, matches a rule, **one** question | insufficient evidence, status *candidate*, follow-up question suggested |
| Same rule on **two different questions** | *likely* (labelled by category), teacher review required |
| Answer marked "guess" | does not count toward the two; the same question repeated counts once |
| One slip, then the follow-up answered correctly | stays candidate, no escalation |
| Teacher-rejected observations | ignored from then on |
| *Confirmed* | **only** a teacher can set it, and only from *likely* |

## 5. Mastery (`mastery/baseline-estimator.ts`, version `baseline-1.0.0`)

```
weight   = decay(age) × difficulty × self-confidence × source
decay    = 0.5 ^ (ageDays / 30)
estimate = (1 × 0.5 + Σ weight × score) / (1 + Σ weight)      score: correct 1, partial 0.5, incorrect 0
```

Status, in order: fewer than 2 eligible items or total weight below 1.5 → **not enough evidence**; estimate < 0.4 → **needs foundation**; ≥ 0.85 with ≥ 4 items and a non-guessed correct answer at difficulty ≥ 3 → **ready for challenge**; ≥ 0.7 with ≥ 3 items → **likely secure**; otherwise **developing**.

Consequences (all tested): one answer never decides anything; two guessed-correct answers are not enough; a confident wrong answer counts as much as a confident right one but a guessed answer counts about half; evidence fades, so a student who was secure months ago returns to "not enough evidence", which is what feeds the Revisit Queue in Phase 8.

The estimate is an internal number for thresholds and ordering. **Do not show it as a percentage.** `explain()` returns every contribution for the "Why?" view. `concept_mastery` is a cache: `recomputeAllMastery` rebuilds it from the ledger, for example after changing the algorithm.

Factors the CLAUDE.md brief lists that this baseline does **not** use yet: variety of question formats (everything is multiple choice so far) and a separate bonus for performance after an intervention. Both are future work.

## 6. Adaptation policy (`adaptation/policy.ts`, version `policy-1.0.0`)

Order of rules:

1. **Needs foundation**: look up to 2 levels up the prerequisite chain. A prerequisite that itself needs foundation → foundation activity on the deepest such concept (teacher reviews). Prerequisites with no evidence → a *prerequisite diagnostic* on the nearest one (not a label). Prerequisites fine → foundation work on this concept.
2. **Likely or confirmed misconception** → targeted guided practice, teacher reviews.
3. Not enough evidence → follow-up assessment. Developing → guided practice. Likely secure → a later revisit question. Ready for challenge → challenge activity.
4. **No endless loops**: the same activity on the same concept, with no change in status, twice already → escalate to *teacher review*. Follow-up assessments never escalate.

Every recommendation follows the contract in `shared/src/recommendation.ts`: concept, activity, prerequisites, evidence ids, plain-language reason, evidence sufficiency (0–1 items insufficient, 2–3 limited, 4+ sufficient), uncertainty, review flag, policy version.

`proposeGroups` sorts students into foundation / guided / challenge / **follow-up** lanes. The follow-up lane holds students who need more evidence or teacher attention; it is not a "struggling" label. Because groups come from statuses that already need several items, one wrong answer cannot place anyone in foundation.

## 7. Did the intervention help? (`adaptation/effectiveness.ts`)

Derived on request from the ledger, never stored or typed in. At assignment the student's status on the target concept is snapshotted. Later: fewer than 2 new counted answers → **not enough evidence** (no claim). No earlier judgement but one now → **evidence gathered**. Otherwise compare status, and if unchanged compare the estimate (±0.15) → improved / no clear change / lower than before. "Not enough evidence" is not treated as the bottom of the scale.

## 8. Revisit queue (`brief/revisit.service.ts`)

A concept a student looked secure on (`likely_secure` or `ready_for_challenge`) with no newer evidence for `revisit.afterDays` (14) comes back as one or two easy approved starter questions. It is a query over stored dates, with no AI. The cached status is the one from the student's last evidence, so a concept that would now read lower because of decay can still appear as "secure" until the student answers again; `recomputeAllMastery` refreshes the cache. The 14 days is a default, not a measured forgetting curve.

## 9. Student portal and hints (`portal/portal.service.ts`)

A student's next step comes from the same `recommendNextActivity` the teacher's Branch Board uses, for the concept they last answered (or the latest lesson the teacher marked taught). It is shown with a plain reason and a friendly word for progress (`just starting`, `keep practising`, `getting there`, `going well`, `ready to try more`), never the teacher's status names, a score or a comparison. Practice answers use source `practice_activity`. **Hints count as weaker evidence**: one hint records the answer as "unsure", two or more as "guess", which the mastery weights discount and which never counts toward a misconception (`selfConfidenceWeights`, `guessCountsAsSignal: false`). Hinted answers therefore carry less weight in both directions: a hint-assisted correct answer counts for about half of an unaided one, so it cannot make a concept look secure on its own, and a hint-assisted wrong answer counts for somewhat less than an unaided one. Practice answers also carry a source weight of 0.8 against 1 for a classroom check. These weights are unvalidated defaults like the rest. Hints come from approved teaching content for the concept (a nudge from the learning objective, a first step, a worked example of a *different* problem), and fall back to general study advice when the content has none, so no hint is written to contain the answer.

## 10. Did mastery tuning happen? Is BKT worth it? (Phase 9 evaluation)

**No tuning was done, because there is no real classroom evidence to tune against.** Every threshold, weight and the 30-day half-life remain documented defaults, unvalidated. A fair evaluation needs: a few classes, a few weeks, and a held-out check such as "does the status predict the next answer on a similar question?". Until then, replacing the estimator would swap one untested model for another. **Bayesian Knowledge Tracing was not implemented.** The reasons: it needs per-concept slip, guess and learn rates that cannot be estimated without data, so defaults would be invented numbers presented with false precision; and the baseline's job (explainable, deterministic, easy for a teacher to check) is already served. The `MasteryEstimator` interface is where it would plug in; the baseline's `explain()` output shows what BKT would have to match for teachers to trust it. A good next step is to log, for each answer, the status *before* it and the result, so that the data to compare estimators exists.

## 11. Misconception rule review

The atlas (`GET /misconceptions/atlas`, the *Misconceptions* page) lists every approved rule with its examples and explanation, plus **this teacher's own** counts of students seen, and confirm and reject decisions. A rule is called `holding_up` (confirmed ≥ 60%), `often_rejected` (≤ 40%) or `mixed` only after at least 5 decisions; before that it says there are too few decisions to say anything. This is a usefulness signal from teachers, not evidence that a rule is educationally valid, and counts never cross teachers. No rule has been retired or refined on this basis because no teacher decisions have been collected yet. The Decimals chapter adds four rules with the same status: authored judgement awaiting teacher feedback.

## Known limitations

- Thresholds, weights and the 30-day half-life are unvalidated defaults.
- Misconception rules and their wrong-option tags are authored judgement; confirm/reject rates (`misconceptionStats`) show teacher usefulness, not scientific validity.
- Only multiple-choice questions exist. Free-text and working-out analysis arrive with the paper pipeline (Phase 6) and AI interpretation (Phase 5).
- Self-confidence relies on students reporting honestly and is optional.
- Everything above is now reachable through teacher routes (activities, learning map, Branch Board, interventions, history) and the student join flow. Thresholds remain unvalidated.
- The follow-up question for a rule is a fixed question key; there is no rotation, so a student asked twice would see the same item (the diagnosis avoids asking it twice).
- The brief is deterministic text with fixed thresholds (`BRIEF_RULES`: at least 3 students with enough answers before any class-level claim, 60% for "looks secure", 40% for "needs more practice"). No language model writes any of it, so it reads plainly rather than smoothly.
- Two correct answers read as "developing" by design (secure needs more evidence). In a class that has only done one short diagnostic, the brief will therefore mostly say "needs more practice". That is the evidence rule at work, not a bug.
- The portal picks one concept per student (the latest they answered). It does not plan a path across a unit.
- The decimals chapter's questions are machine-checked only where the stem is a sum, difference or comparison; the rest were checked by hand by the authors and need a subject teacher's review.

## 12. Copilot suggestions (`modules/lessons/copilot.ts`)

Rule-based, from the current check's recorded answers, the lesson's own misconception patterns and the earlier ideas' mastery. It reuses `RECOMMENDATION_RULES` (`minAnswered`, `minRosterShare`). Below that, the only suggestion is "collect more answers". A pattern suggestion needs enough students matching it and is never above `medium` certainty, because a wrong option is possible evidence, not a confirmed misconception. "Move on" can be `high` only when at least half the class answered. The AI is never asked to decide anything here; it can only draft an explanation on request, and that draft stays unapproved. Not validated against learning outcomes.

Known limitation: the map and copilot describe "not enough evidence" the same way whether a student has no answers or one or two (both are below the rule). The counts cannot tell them apart, so the wording says "not enough recorded answers to describe it" rather than "no answers".

## 13. Quick polls are not evidence

A poll answer ("I am not sure yet", or a true/false tap) is a class-level signal for the teacher in the moment. It is not scored, not reviewed and never enters `assessment_evidence` or the mastery estimate. Self-reported confidence in particular is unreliable on its own, so it is kept away from anything that labels a student.

## 14. Growth and recognition (`modules/insights/growth.ts`, rules in `GROWTH_RULES`)

Private to the teacher and never a ranking. Groups: **ready for a challenge** (mastery status), **recently secure** (likely secure with answers in the last 14 days), **improved** (at least 4 counted answers on one concept, a mistake among the first two, the latest two right: measured against the student's own start), **consistent practice** (at least 3 own practice sets in 14 days; hidden when no practice is recorded), **could use another explanation** (needs foundation from at least 2 counted answers). Only evidence that can affect mastery is used; no clicks, screen time or attendance.

## 15. Atlas: review states and tracking (`modules/insights/atlas.service.ts`)

Per student and pattern, the review state is *open*, *confirmed*, *dismissed* or **inconclusive** (new). Inconclusive keeps the evidence and still counts as an earlier answer, so a later matching answer in a different question reopens it. Evidence strength for a pattern in a class: *seen once per student*, *repeated* (a student matched it in more than one answer), or *confirmed* by the teacher. **Track** looks at each affected student's counted answers on the concept after their latest matching answer: *understanding shown* needs two right and none wrong; one right is *partly*; a new match is *same error again*; other wrong answers are *other mistakes*; nothing new is *no new evidence*. Launching an activity never marks a pattern resolved.
