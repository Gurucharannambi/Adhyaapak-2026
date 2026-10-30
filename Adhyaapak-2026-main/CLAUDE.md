# ADHYAAPAK — AGENTIC LEARNING INTELLIGENCE & PRODUCT EVOLUTION

You are a senior AI systems architect, agentic workflow engineer, education product designer, and full-stack engineer. Your task is to evolve **Adhyaapak**, a teacher-led adaptive learning platform for Indian schools, into a sophisticated, genuinely useful agentic learning system.

This is not a request to add a chatbot to an existing dashboard. Design and implement coordinated AI workflows that use tools, inspect evidence, plan actions, evaluate results, maintain state, and produce useful outcomes for teachers.

The objective is to build a product in which AI helps teachers prepare lessons, understand student difficulties, design targeted interventions, evaluate learning evidence, and decide what to teach next.

The teacher must remain in control of consequential educational decisions.

## 1. Begin with a thorough repository audit

Before coding:

- Inspect the existing frontend, backend, database, API routes, authentication, authorization, lesson system, assessment system, Misconception Atlas, offline functionality and tests.
- Read the repository instructions, `CLAUDE.md`, package manifests, environment configuration examples and relevant documentation.
- Identify existing LLM integrations, model configuration, tool-calling support, background jobs, persistence and available APIs.
- Trace which user workflows actually work and which are incomplete or simulated.
- Identify existing functionality that should be extended rather than duplicated.
- Verify the configured Mesh API base URL, supported model, request format, tool-calling capabilities, rate limits and error behavior from existing configuration and available documentation. Do not assume an API feature is supported simply because a framework offers it.

Produce a brief implementation plan, then implement the work. Do not stop after describing recommendations.

Preserve the current technology stack unless the repository contains a compelling reason to change it. Keep the system modular, maintainable and testable.

## 2. Establish a proper agent architecture

Use LangChain and, where its orchestration capabilities are appropriate, LangGraph to implement persistent, stateful workflows.

Prefer a small number of well-defined agents and deterministic tools over a large collection of loosely coordinated autonomous agents.

Separate the following responsibilities:

**Orchestrator**
- Receives a teacher's request or a classroom event.
- Determines which workflow is appropriate.
- Creates a typed workflow state and execution plan.
- Routes work to specialized agents or deterministic tools.
- Tracks progress, errors, pending approvals and completed steps.
- Resumes interrupted workflows without unnecessarily repeating completed work.

**Curriculum agent**
- Works with approved curriculum sources, concepts, learning objectives and prerequisite relationships.
- Identifies missing information and proposes a curriculum structure for review.

**Assessment agent**
- Creates age-appropriate diagnostic questions, distractors, worked solutions and answer keys.
- Maps each question to a specific learning objective and concept.
- Evaluates responses using appropriate deterministic rules or reviewed AI-assisted evaluation.

**Learning evidence agent**
- Inspects persisted assessment evidence and identifies recurring answer patterns.
- Distinguishes observed facts from hypotheses.
- Calculates quantitative metrics using code and database queries rather than asking an LLM to invent statistics.

**Intervention planning agent**
- Uses approved lesson content, curriculum relationships and evidence to recommend appropriate explanations, activities and follow-up questions.
- Considers different levels of learner readiness.

**Quality assurance agent**
- Validates generated content for correctness, age appropriateness, curriculum alignment, consistency, answer-key validity and unsupported claims.
- Rejects or flags content that fails validation.

These are logical responsibilities, not necessarily separate deployed services or separate LLM calls. Combine them when a simpler implementation is more reliable.

Implement each workflow as a typed state machine or graph with explicit states, validated inputs and outputs, bounded retries, timeouts, error handling and resumability.

Use deterministic code for permissions, calculations, database writes, state transitions and validation wherever possible.

Do not create an agent merely to perform a simple database lookup.

## 3. Build these agentic workflows

### Workflow A — Curriculum-to-Learning-Path Agent

**Goal:** Turn a teacher's syllabus into a reviewed, connected and teachable learning plan.

Process:

1. Accept a syllabus file or an existing curriculum selection.
2. Extract text and relevant curriculum structure using the appropriate parser.
3. Identify chapters, topics, learning objectives and concepts.
4. Propose prerequisite relationships between concepts.
5. Identify missing, ambiguous or potentially duplicated topics.
6. Generate a structured concept graph.
7. Validate that the graph has valid references, no unintended cycles and a reasonable prerequisite structure.
8. Compare the result with existing approved curriculum records.
9. Generate a proposed sequence of lessons and diagnostic checkpoints.
10. Present the proposed graph, uncertainties and source references to the teacher.
11. Save approved curriculum changes only after authorized confirmation.

The workflow should support review and revision of individual concepts rather than forcing the teacher to approve or reject the entire graph.

**Deliverable:** A structured, reviewable curriculum graph and an initial lesson sequence linked to the application's actual curriculum model.

Do not silently treat AI-generated curriculum relationships as authoritative.

### Workflow B — Adaptive Lesson Preparation Agent

**Goal:** Help teachers prepare a complete lesson tailored to their class and available evidence.

Inputs:
- Selected timetable entry or class.
- Curriculum concept.
- Lesson duration.
- Approved curriculum resources.
- Available student learning evidence.
- Teacher preferences and classroom constraints.

Process:

1. Retrieve the selected class, relevant curriculum concepts and previous lesson records.
2. Determine prerequisite knowledge and the intended learning outcomes.
3. Inspect relevant assessment evidence when it exists.
4. Identify areas where evidence is missing or uncertain.
5. Plan a lesson with a clear introduction, explanation, worked example, guided practice, diagnostic checkpoint and conclusion.
6. Generate suitable teaching visuals or structured interactive activities supported by the existing application.
7. Generate a small diagnostic assessment with validated answers and explanations.
8. Propose alternative explanations or differentiated tasks where justified.
9. Run content and answer-key validation.
10. Present the draft to the teacher for review and editing.
11. Save the approved lesson and connect it to the timetable entry.

The lesson should be teachable with a projector, teacher-operated laptop, shared devices or printable materials. Do not assume every student has a personal device.

**Deliverable:** A complete editable lesson plan with structured teaching activities, diagnostic questions and relevant follow-up options.

### Workflow C — Misconception Investigation and Intervention Agent

**Goal:** Turn recurring learning difficulties into evidence-backed teaching interventions.

This workflow should be integrated directly with the Misconception Atlas.

Process:

1. Retrieve relevant responses from persisted assessments.
2. Group responses by curriculum concept and question type.
3. Use deterministic analysis to identify repeated answer patterns and their frequency.
4. Ask the model to interpret the patterns as possible reasoning errors, using only the supplied evidence.
5. Compare the hypothesis with approved curriculum knowledge and known prerequisite relationships.
6. Assign an evidence status such as insufficient evidence, possible pattern, teacher-reviewed or supported by repeated observations.
7. Display the original responses, sample size, dates, explanation and uncertainty.
8. Let the teacher confirm, dismiss or mark the hypothesis inconclusive.
9. After confirmation, propose a targeted intervention.
10. Generate an explanation, worked example, interactive activity or differentiated worksheet.
11. Validate the generated content and answers.
12. Let the teacher approve and launch the intervention.
13. Generate a new diagnostic that tests the underlying concept.
14. Persist the subsequent results and compare them with the previous evidence.
15. Update the concept's learning history based on the new evidence.

Never classify a child as having a permanent misconception based on one incorrect response.

Do not automatically mark a misconception as resolved because an intervention was launched or completed.

**Deliverable:** A complete evidence-to-intervention-to-reassessment workflow with teacher approval and persistent learning history.

### Workflow D — Adaptive Assessment and Paper Evaluation Agent

**Goal:** Make assessment creation and evaluation a connected workflow rather than a collection of independent AI features.

For digital assessments:

1. Generate questions from approved learning objectives.
2. Create an answer key and explanatory rationale.
3. Validate answer-key consistency.
4. Map questions to concepts and difficulty levels.
5. Allow teacher review before publication.
6. Evaluate submitted responses using deterministic grading for objective questions and appropriately constrained evaluation for free-text responses.
7. Flag ambiguous responses for teacher review.
8. Persist results and concept-level evidence.

For paper-based assessments, if image upload and OCR or vision capabilities are supported:

1. Accept an uploaded image or document.
2. Extract questions and student answers.
3. Identify uncertain handwriting, OCR errors and ambiguous answer boundaries.
4. Display the extracted content beside the original image.
5. Require teacher review for uncertain or consequential results.
6. Persist approved evaluation results with source references.
7. Update the same assessment and learning-evidence model used by digital assessments.

Never claim OCR or vision processing succeeded if it was not actually executed. If the configured provider cannot process images, implement a clearly reported limitation rather than pretending.

**Deliverable:** A reviewable assessment pipeline that produces reliable, traceable evidence.

### Workflow E — Class-Level Teaching Strategy Agent

**Goal:** Help teachers respond to patterns across an entire class.

Process:

1. Retrieve actual evidence for the selected class and time period.
2. Identify concepts with strong evidence of difficulty, mixed understanding or insufficient observations.
3. Find shared prerequisite gaps where curriculum relationships support the connection.
4. Estimate which students may benefit from additional guidance, using transparent criteria.
5. Propose a teaching plan with foundation, guided practice, independent practice and extension options where appropriate.
6. Generate activities suitable for each proposed group.
7. Explain why each activity and grouping is recommended.
8. Allow the teacher to inspect and modify recommendations.
9. Let the teacher approve activities and launch them in the live classroom.
10. Evaluate subsequent evidence and update the plan.

Do not create fixed ability labels for students. Groupings should be temporary, concept-specific and revisable.

Do not invent student performance data or infer effort from screen time, clicks or unsupported behavioral signals.

**Deliverable:** A teacher-reviewed class intervention plan linked to real classroom activities and subsequent assessments.

### Workflow F — Classroom Copilot with Tool Use

**Goal:** Create a contextual assistant that can perform meaningful tasks inside Adhyaapak.

The copilot should understand the current class, lesson, curriculum concept and classroom session, subject to authorization.

Example teacher requests:

- "Prepare a ten-minute diagnostic for equivalent fractions."
- "Show me the questions students most frequently answered incorrectly."
- "Create a simpler explanation of this concept."
- "Give students who understand this concept a harder problem."
- "Prepare a printable worksheet for tomorrow's lesson."
- "Compare today's results with the previous assessment."
- "Suggest the next activity based on the evidence we have."
- "Summarize the learning outcomes from the last session."

Implement these as structured workflows using explicitly registered tools, such as:

- `get_class_context`
- `get_curriculum_concepts`
- `get_lesson_history`
- `get_assessment_results`
- `get_concept_evidence`
- `create_lesson_draft`
- `create_assessment_draft`
- `create_intervention_draft`
- `get_student_learning_history`
- `save_approved_lesson`
- `launch_approved_activity`
- `generate_session_summary`

These are proposed tool names; adapt them to the repository's actual service boundaries and naming conventions.

Tool definitions must have typed schemas, input validation, authorization checks and constrained outputs. Read tools should be separated from write tools.

The model must not be able to bypass backend authorization by calling a tool with a different student or class identifier.

Drafting should be easy. Publishing, launching consequential actions, modifying records or sharing student information must follow explicit permissions and confirmation rules.

The copilot should display the actions it proposes or executes, the relevant results and any required approvals. It must not pretend to have executed a tool when it has only generated text.

### Workflow G — Evidence-Based Session Review Agent

**Goal:** Turn a completed lesson into a useful next-lesson plan.

Process:

1. Retrieve the actual classroom session, approved lesson activities, assessment responses and relevant participation records.
2. Determine which learning objectives were covered.
3. Summarize observed class-level understanding and remaining uncertainty.
4. Identify concepts that may need further instruction.
5. Compare results with previous comparable evidence when available.
6. Propose follow-up activities and questions for the next lesson.
7. Identify students who may benefit from follow-up, using transparent evidence and appropriate privacy controls.
8. Generate a teacher-editable session summary.
9. Persist the approved summary and link it to the next relevant lesson.

Do not invent attendance, student participation, learning gains or activities that did not occur.

When evidence is incomplete, state what cannot be concluded.

**Deliverable:** A persisted session summary and a set of actionable, evidence-backed follow-up recommendations.

### Workflow H — Learning Progression and Review Scheduler

**Goal:** Help teachers decide what to revisit and when.

Process:

1. Inspect the concept mastery history and available assessment dates.
2. Identify concepts that may need another check or spaced review.
3. Consider prerequisite relationships and previously demonstrated understanding.
4. Recommend short review activities and follow-up questions.
5. Explain the evidence behind each recommendation.
6. Add proposed items to the teacher's review queue.
7. Let the teacher approve or modify the schedule.
8. Record completion and use new assessment evidence to update future recommendations.

Do not present predicted forgetting or future performance as certain. Use simple, transparent heuristics initially, and only introduce more complex models when there is sufficient data and a demonstrated benefit.

**Deliverable:** A teacher-controlled review queue that connects past learning to upcoming lessons.

## 4. Implement durable workflows, not fragile chains of prompts

For workflows that span multiple steps or require human approval, persist execution state.

Use explicit workflow states such as:

- `queued`
- `running`
- `awaiting_review`
- `awaiting_approval`
- `completed`
- `failed`
- `cancelled`

Adapt these states to the selected orchestration framework.

Requirements:

- Persist meaningful workflow inputs, outputs, status and references to source records.
- Resume interrupted workflows from the last safe checkpoint.
- Apply bounded retries and timeouts.
- Distinguish retryable failures from validation or permission failures.
- Make database writes idempotent where appropriate.
- Avoid duplicate assessments, interventions and session summaries during retries.
- Support cancellation where appropriate.
- Record important transitions and approval decisions.
- Provide a useful progress view for long-running workflows.
- Ensure partial failure is visible and recoverable.
- Keep workflow state consistent with the actual persisted domain records.

Use a background job mechanism only where the workflow genuinely benefits from asynchronous execution. Do not introduce unnecessary infrastructure when a simpler durable implementation suffices.

## 5. Build a shared evidence and provenance model

All agents must use the same underlying curriculum and learning-evidence model.

For each important generated artifact, track where appropriate:

- Workflow identifier.
- Source curriculum concepts.
- Source assessment or session records.
- Relevant evidence references.
- Model and configuration information, where available.
- Validation results.
- Teacher edits and approvals.
- Current publication status.
- Creation and update timestamps.

Do not duplicate the entire student record or private assessment content into every agent's state.

Keep quantitative calculations deterministic and traceable. The LLM may interpret evidence, but it must not fabricate missing observations.

A generated recommendation should be explainable in plain language: which evidence supports it, what remains uncertain and what action the teacher can take.

## 6. Treat AI-generated content as untrusted until validated

Implement a quality pipeline for generated lessons, assessments, explanations and interventions.

Validate:
- Output schema and required fields.
- Curriculum and grade alignment.
- Mathematical correctness and answer-key consistency.
- Age-appropriate language.
- Contradictions and unsupported factual claims.
- Duplicate or redundant questions.
- References to nonexistent concepts or student records.
- Safe handling of uploaded content and prompt injection attempts.

For mathematical content, use deterministic checks where feasible. For generated questions, verify that the expected answer follows from the question and that distractors are not accidentally correct.

If validation fails, allow a bounded repair attempt. If it still fails, flag the draft for teacher editing instead of publishing it.

Never treat uploaded documents or student submissions as trusted instructions to the agent.

## 7. Design the agentic user experience

Make agentic workflows visible in the existing product rather than hiding them behind a generic chat interface.

Integrate them into:
- Today: preparation and follow-up recommendations.
- Lessons: lesson preparation and curriculum planning.
- Assessments: question generation, evaluation and review.
- Insights: evidence-backed findings and next actions.
- Misconception Atlas: investigation and intervention.
- Live Classroom: contextual copilot and activity launching.
- Session review: learning summary and next-lesson recommendations.

A workflow view should communicate:
- What the system is trying to accomplish.
- Which step is currently active.
- Which evidence or artifacts it is using.
- What has actually completed.
- What needs teacher review.
- What failed and how to recover.
- What will happen if the teacher approves the next step.

Use the existing visual design system. Keep the interface polished, calm, classroom-friendly and accessible. Avoid excessive AI-themed decoration, fake activity indicators and animations that imply work is occurring when nothing is running.

The teacher should be able to inspect generated drafts before they affect students.

## 8. Security, privacy and educational responsibility

Implement the following safeguards:

- Enforce role-based authorization on every backend tool and data-access path.
- Restrict all student evidence to authorized users and classes.
- Minimize student data sent to external model providers.
- Keep credentials server-side.
- Validate tool inputs and uploaded content.
- Limit agent access to the tools required for the current workflow.
- Do not allow generated instructions to expand tool permissions.
- Require confirmation before publishing content or taking consequential actions.
- Preserve audit records for important approvals and changes.
- Avoid permanent negative labels about students.
- Do not make consequential student decisions autonomously.
- Make uncertainty visible.
- Provide teacher override and correction mechanisms.

If external model processing is unavailable, fails or times out, communicate that honestly and preserve the teacher's work.

## 9. Use Mesh API and LangChain responsibly

Inspect the current repository's Mesh API integration and reuse it where appropriate.

- Verify the actual configured endpoint and model.
- Use the existing provider adapter if it is functional.
- Confirm supported structured output, tool calling, streaming and multimodal capabilities rather than assuming them.
- Validate model output against application schemas.
- Add sensible timeouts, bounded retries and error handling.
- Keep prompts and output contracts versioned where useful.
- Avoid sending entire student records or full conversation histories unnecessarily.
- Record usage and latency where the available API responses support reliable measurement.
- Never claim token savings or performance improvements without measurements.

If the configured model cannot reliably support a particular orchestration capability, use deterministic application logic for that part or redesign the workflow. Do not fake agent execution to preserve the appearance of autonomy.

## 10. Evaluation and testing

Create tests for both individual agents and complete workflows.

Test:
- Valid and invalid structured model outputs.
- Missing or contradictory evidence.
- Incorrect answer-key generation.
- Prompt injection in uploaded content.
- Unauthorized class and student access.
- Tool-call validation and permissions.
- Timeouts, rate limits and provider errors.
- Interrupted workflows and resumption.
- Retry behavior and idempotency.
- Teacher edits and approval checkpoints.
- Persistence after browser refresh.
- Duplicate prevention.
- Subsequent assessments updating the correct concepts.
- Honest behavior when the model or OCR provider is unavailable.

Create a small, clearly labeled evaluation dataset for the initial Mathematics equivalent-fractions workflow. Include correct answers, common incorrect answers, ambiguous responses and cases where there is insufficient evidence to infer a misconception.

Measure correctness, schema validity, curriculum alignment, unsupported claims, latency and workflow completion where applicable.

Use real provider calls only in explicitly configured integration tests. Make unit and integration tests deterministic and inexpensive wherever possible.

## 11. Implementation order

Implement in this order, adjusting for dependencies discovered during the audit.

**Phase 1:** Shared domain model, evidence provenance, tool registry, validation schemas and provider integration.

**Phase 2:** Curriculum-to-learning-path workflow and adaptive lesson preparation.

**Phase 3:** Misconception investigation, intervention generation and reassessment.

**Phase 4:** Assessment creation, evaluation and paper submission review where supported.

**Phase 5:** Contextual classroom copilot and session review.

**Phase 6:** Class-level teaching strategy and learning progression scheduler.

**Phase 7:** Workflow monitoring, recovery, evaluation, security hardening and interface polish.

Do not implement all workflows as unconnected demos. Prioritize a small number of complete, persisted, testable end-to-end journeys before expanding.

## 12. Required first end-to-end demonstration

The initial implementation must demonstrate this complete journey using the application's actual data model:

1. A teacher opens an assigned Mathematics class.
2. The teacher selects equivalent fractions.
3. The curriculum and evidence tools retrieve relevant persisted records.
4. The lesson preparation workflow generates a structured lesson and diagnostic.
5. The quality checks validate the lesson and answer key.
6. The teacher reviews and approves the draft.
7. The lesson is saved and launched in the classroom.
8. Student responses are submitted through the application's supported response mechanism.
9. Results are persisted and quantitative patterns are calculated.
10. The misconception workflow identifies a possible repeated reasoning error, with supporting evidence.
11. The teacher reviews the evidence and approves an intervention.
12. A targeted activity is generated, validated and launched.
13. A new diagnostic tests the underlying concept.
14. The new evidence updates the relevant student and class learning histories.
15. The session review workflow produces a teacher-editable summary.
16. The teacher can reload the application and inspect the saved records and workflow history.

If real student devices or an external provider are unavailable, use a clearly labeled teacher-operated or test-data mechanism. Never represent test data as real student participation.

## Final deliverable

Implement the architecture and workflows in the existing repository. Do not stop at a design proposal.

At the end, report:
- Existing architecture and capabilities discovered.
- Agent and tool responsibilities implemented.
- Complete workflows that actually work end to end.
- Database and API changes.
- Validation, security and approval safeguards.
- Tests executed and their actual results.
- Known limitations and remaining work.

Do not claim a workflow is complete because it generates a plausible response. It is complete only when its state, outputs and intended domain changes are validated, persisted, permission-checked and recoverable.

**Product principle:** Adhyaapak should use AI to help teachers make better-informed teaching decisions. Agents may investigate, plan, generate, validate and recommend. Teachers retain control over what is taught, which student evidence is accepted and which consequential actions are taken.