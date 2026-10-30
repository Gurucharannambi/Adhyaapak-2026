import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Provenance } from "@adhyaapak/shared";

export const roleEnum = pgEnum("role", ["teacher", "student", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);

export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  board: text("board"),
  region: text("region"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").references(() => schools.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // Stored lower-cased by the application; the unique index below enforces it in the database too.
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

/** Server-side sessions. Only a SHA-256 hash of the cookie token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

/**
 * Append-only record of important actions (CLAUDE.md §14). actor_id is not a cascading FK:
 * audit rows must outlive the user rows they describe.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_actor_idx").on(t.actorId, t.createdAt), index("audit_entity_idx").on(t.entityType, t.entityId)],
);

// ---------------------------------------------------------------------------
// Classroom
// ---------------------------------------------------------------------------

export const enrolmentStatusEnum = pgEnum("enrolment_status", ["active", "withdrawn"]);

export const classes = pgTable(
  "classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").references(() => schools.id, { onDelete: "restrict" }),
    // Deleting a teacher must not silently delete class records.
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    grade: integer("grade").notNull(),
    academicYear: text("academic_year").notNull(),
    joinCode: text("join_code").notNull().unique(),
    /** Students may use the optional practice portal. Off until the teacher turns it on. */
    portalEnabled: boolean("portal_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("classes_teacher_idx").on(t.teacherId), check("classes_grade_range", sql`${t.grade} between 6 and 10`)],
);

/** Student identity only. Learning analytics live in separate tables keyed by this id (CLAUDE.md §10). */
export const studentProfiles = pgTable("student_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Set only if the student later gets their own account (Phase 8).
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  referenceId: text("reference_id"),
  preferredLanguage: text("preferred_language").notNull().default("en"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const classEnrolments = pgTable(
  "class_enrolments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "restrict" }),
    // With the class join code this identifies a student in a classroom session.
    rosterNumber: integer("roster_number").notNull(),
    status: enrolmentStatusEnum("status").notNull().default("active"),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("enrolments_class_student_uq").on(t.classId, t.studentId),
    uniqueIndex("enrolments_class_roster_uq").on(t.classId, t.rosterNumber),
    index("enrolments_student_idx").on(t.studentId),
  ],
);

// ---------------------------------------------------------------------------
// Curriculum and knowledge
// ---------------------------------------------------------------------------

export const reviewStatusEnum = pgEnum("review_status", ["draft", "reviewed", "approved", "rejected"]);
export const resourceTypeEnum = pgEnum("resource_type", ["explanation", "worked_example", "teacher_note"]);
export const teachingLevelEnum = pgEnum("teaching_level", ["foundation", "guided", "challenge"]);
export const questionRoleEnum = pgEnum("question_role", ["diagnostic", "guided", "challenge"]);

export const subjects = pgTable("subjects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});

export const curriculumVersions = pgTable(
  "curriculum_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    board: text("board").notNull(),
    academicYear: text("academic_year").notNull(),
    grade: integer("grade").notNull(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    language: text("language").notNull().default("en"),
    version: integer("version").notNull().default(1),
    sourceReference: text("source_reference"),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("curriculum_versions_uq").on(t.board, t.academicYear, t.grade, t.subjectId, t.language, t.version),
    check("curriculum_grade_range", sql`${t.grade} between 6 and 10`),
  ],
);

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    curriculumVersionId: uuid("curriculum_version_id")
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    chapterOrder: integer("chapter_order").notNull(),
    /** Our own plain-language summary of the chapter (original text, never copied from a textbook). */
    summary: text("summary"),
    /** A few key ideas for the teacher to land in this chapter. */
    keyIdeas: jsonb("key_ideas").$type<string[]>(),
  },
  (t) => [uniqueIndex("chapters_order_uq").on(t.curriculumVersionId, t.chapterOrder)],
);

export const concepts = pgTable(
  "concepts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    curriculumVersionId: uuid("curriculum_version_id")
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: "restrict" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "restrict" }),
    // Stable slug so seeds and content stay idempotent across re-runs.
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    learningObjective: text("learning_objective").notNull(),
    conceptOrder: integer("concept_order").notNull(),
    language: text("language").notNull().default("en"),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("draft"),
    provenance: jsonb("provenance").$type<Provenance>().notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("concepts_key_uq").on(t.curriculumVersionId, t.key), index("concepts_chapter_idx").on(t.chapterId)],
);

/** Edge A -> B means A is a prerequisite for B (CLAUDE.md §3). */
export const conceptPrerequisites = pgTable(
  "concept_prerequisites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prerequisiteConceptId: uuid("prerequisite_concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    dependentConceptId: uuid("dependent_concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    sourceReference: text("source_reference"),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("prerequisites_pair_uq").on(t.prerequisiteConceptId, t.dependentConceptId),
    index("prerequisites_dependent_idx").on(t.dependentConceptId),
    check("prerequisites_no_self_edge", sql`${t.prerequisiteConceptId} <> ${t.dependentConceptId}`),
  ],
);

export const learningResources = pgTable(
  "learning_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    key: text("key").notNull().unique(),
    type: resourceTypeEnum("type").notNull(),
    level: teachingLevelEnum("level"),
    title: text("title").notNull(),
    language: text("language").notNull().default("en"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    provenance: jsonb("provenance").$type<Provenance>().notNull(),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("draft"),
    // Set for drafts a teacher asked the AI to write. Seeded content has no creator.
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("resources_concept_idx").on(t.conceptId)],
);

export interface QuestionOption {
  id: string;
  text: string;
  /** Misconception pattern key this wrong option points to. */
  misconceptionKey?: string;
}

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    role: questionRoleEnum("role").notNull(),
    difficulty: integer("difficulty").notNull(),
    stem: text("stem").notNull(),
    options: jsonb("options").$type<QuestionOption[]>().notNull(),
    correctOptionId: text("correct_option_id").notNull(),
    explanation: text("explanation").notNull(),
    language: text("language").notNull().default("en"),
    provenance: jsonb("provenance").$type<Provenance>().notNull(),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("questions_concept_idx").on(t.conceptId), check("questions_difficulty_range", sql`${t.difficulty} between 1 and 5`)],
);

/** Extra concepts a question also assesses (e.g. prerequisite skills). The primary concept is on `questions`. */
export const questionConcepts = pgTable(
  "question_concepts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    relationshipType: text("relationship_type").notNull(),
  },
  (t) => [uniqueIndex("question_concepts_uq").on(t.questionId, t.conceptId)],
);

export const misconceptionPatterns = pgTable(
  "misconception_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    // Validated data, never executable code (CLAUDE.md §10). Phase 3 defines and validates the exact shape.
    triggerDefinition: jsonb("trigger_definition").$type<Record<string, unknown>>().notNull(),
    followUpDefinition: jsonb("follow_up_definition").$type<Record<string, unknown>>().notNull(),
    recommendedExplanation: text("recommended_explanation").notNull(),
    exampleWrongAnswers: jsonb("example_wrong_answers").$type<string[]>().notNull(),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("misconceptions_concept_idx").on(t.conceptId)],
);

// ---------------------------------------------------------------------------
// Assessments, evidence and mastery (Phase 3)
// ---------------------------------------------------------------------------

export const assessmentTypeEnum = pgEnum("assessment_type", ["diagnostic", "prerequisite_pulse", "follow_up", "practice"]);
export const assessmentStatusEnum = pgEnum("assessment_status", ["draft", "approved", "open", "closed"]);
export const attemptStatusEnum = pgEnum("attempt_status", ["in_progress", "submitted"]);
export const evidenceResultEnum = pgEnum("evidence_result", ["correct", "partial", "incorrect", "insufficient"]);
export const evidenceSourceEnum = pgEnum("evidence_source", [
  "device_response",
  "teacher_entered",
  "paper_reviewed",
  "offline_synced",
  "practice_activity",
]);
export const evidenceConfidenceEnum = pgEnum("evidence_confidence", ["low", "medium", "high"]);
export const evidenceReviewStatusEnum = pgEnum("evidence_review_status", ["not_required", "pending", "approved", "rejected"]);
export const selfConfidenceEnum = pgEnum("self_confidence", ["sure", "unsure", "guess"]);
export const masteryStatusEnum = pgEnum("mastery_status", [
  "not_enough_evidence",
  "needs_foundation",
  "developing",
  "likely_secure",
  "ready_for_challenge",
]);
export const misconceptionStatusEnum = pgEnum("misconception_status", ["candidate", "likely", "confirmed", "rejected", "inconclusive"]);

export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    type: assessmentTypeEnum("type").notNull(),
    /** Set for a student's own practice set from the portal. Such sets are private to that student and never listed to the teacher as class activities. */
    ownerStudentId: uuid("owner_student_id").references(() => studentProfiles.id, { onDelete: "restrict" }),
    status: assessmentStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** When the teacher let students see their own results (right/wrong and explanations). Null until then. */
    resultsReleasedAt: timestamp("results_released_at", { withTimezone: true }),
  },
  (t) => [
    index("assessments_class_idx").on(t.classId, t.createdAt),
    // At most one open activity per class, so a joining student is never ambiguous.
    uniqueIndex("assessments_one_open_per_class_uq").on(t.classId).where(sql`${t.status} = 'open'`),
  ],
);

export const assessmentQuestions = pgTable(
  "assessment_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    sequenceOrder: integer("sequence_order").notNull(),
  },
  (t) => [uniqueIndex("assessment_questions_uq").on(t.assessmentId, t.questionId), uniqueIndex("assessment_questions_order_uq").on(t.assessmentId, t.sequenceOrder)],
);

export const assessmentAttempts = pgTable(
  "assessment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "restrict" }),
    submissionSource: evidenceSourceEnum("submission_source").notNull(),
    status: attemptStatusEnum("status").notNull().default("submitted"),
    // Client-generated key: a retried submission with the same key returns the original attempt.
    syncId: text("sync_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
  },
  (t) => [
    // One attempt per student per assessment, and one per idempotency key.
    uniqueIndex("attempts_assessment_student_uq").on(t.assessmentId, t.studentId),
    uniqueIndex("attempts_sync_uq").on(t.syncId),
  ],
);

export const questionResponses = pgTable(
  "question_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => assessmentAttempts.id, { onDelete: "restrict" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    responseData: jsonb("response_data").$type<Record<string, unknown>>().notNull(),
    selfConfidence: selfConfidenceEnum("self_confidence"),
    result: evidenceResultEnum("result").notNull(),
    resultReason: text("result_reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("responses_attempt_question_uq").on(t.attemptId, t.questionId)],
);

/** The evidence ledger (principle 2). Rows are never deleted; only `review_status` may change, via review workflows. */
export const assessmentEvidence = pgTable(
  "assessment_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "restrict" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    questionResponseId: uuid("question_response_id")
      .notNull()
      .references(() => questionResponses.id, { onDelete: "restrict" }),
    source: evidenceSourceEnum("source").notNull(),
    result: evidenceResultEnum("result").notNull(),
    difficulty: integer("difficulty").notNull(),
    selfConfidence: selfConfidenceEnum("self_confidence"),
    confidence: evidenceConfidenceEnum("confidence").notNull(),
    reviewStatus: evidenceReviewStatusEnum("review_status").notNull(),
    // "primary" = the question's main concept; "also_assesses" = a prerequisite skill credited only on correct answers.
    relationship: text("relationship").notNull().default("primary"),
    matchedMisconceptionPatternId: uuid("matched_misconception_pattern_id").references(() => misconceptionPatterns.id, { onDelete: "restrict" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("evidence_response_concept_uq").on(t.questionResponseId, t.conceptId),
    index("evidence_student_concept_idx").on(t.studentId, t.conceptId, t.observedAt),
    check("evidence_difficulty_range", sql`${t.difficulty} between 1 and 5`),
  ],
);

/** Derived cache of the evidence ledger; always recomputable (principle 9). */
export const conceptMastery = pgTable(
  "concept_mastery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "restrict" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    estimate: doublePrecision("estimate").notNull(),
    status: masteryStatusEnum("status").notNull(),
    evidenceCount: integer("evidence_count").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    lastEvidenceAt: timestamp("last_evidence_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mastery_student_concept_uq").on(t.studentId, t.conceptId), check("mastery_estimate_range", sql`${t.estimate} between 0 and 1`)],
);

export const misconceptionObservations = pgTable(
  "misconception_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "restrict" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    patternId: uuid("pattern_id")
      .notNull()
      .references(() => misconceptionPatterns.id, { onDelete: "restrict" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => assessmentEvidence.id, { onDelete: "restrict" }),
    status: misconceptionStatusEnum("status").notNull().default("candidate"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("observations_evidence_uq").on(t.evidenceId), index("observations_student_pattern_idx").on(t.studentId, t.patternId)],
);

// ---------------------------------------------------------------------------
// Classroom sessions (Phase 4)
// ---------------------------------------------------------------------------

/**
 * A student joins a classroom activity with the class join code + roster number (no password,
 * no personal data). The session is short-lived and can only answer the class's open activity.
 * Only a hash of the cookie token is stored.
 */
export const studentSessions = pgTable(
  "student_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "restrict" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("student_sessions_expires_idx").on(t.expiresAt)],
);

// ---------------------------------------------------------------------------
// Interventions (Phase 4, slice B)
// ---------------------------------------------------------------------------

export const groupKeyEnum = pgEnum("group_key", ["foundation", "guided", "challenge", "follow_up"]);
export const activityTypeEnum = pgEnum("activity_type", [
  "prerequisite_diagnostic",
  "foundation_activity",
  "guided_practice",
  "challenge_activity",
  "follow_up_assessment",
  "revisit_question",
  "teacher_review",
]);
export const interventionStatusEnum = pgEnum("intervention_status", ["assigned", "completed", "dismissed"]);

/**
 * A teacher's decision to give one student an activity. The system's own recommendation and the
 * student's state at that moment are stored next to the teacher's final choice, so "did it work?"
 * can be answered later from data and overrides are kept as signal (principle 4).
 * Whether it worked is NOT stored: it is derived from the evidence ledger when asked (principle 9).
 */
export const interventions = pgTable(
  "interventions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "restrict" }),
    /** The lesson concept the board was about. */
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    /** The concept the activity actually targets (a prerequisite when a gap was found). */
    targetConceptId: uuid("target_concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    groupKey: groupKeyEnum("group_key").notNull(),
    recommendedGroupKey: groupKeyEnum("recommended_group_key").notNull(),
    activityType: activityTypeEnum("activity_type").notNull(),
    recommendedActivityType: activityTypeEnum("recommended_activity_type").notNull(),
    /** Why the teacher moved the student away from the recommendation. Required when they differ. */
    movedReason: text("moved_reason"),
    reason: text("reason").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
    prerequisiteConceptIds: jsonb("prerequisite_concept_ids").$type<string[]>().notNull(),
    status: interventionStatusEnum("status").notNull().default("assigned"),
    statusAtAssignment: masteryStatusEnum("status_at_assignment").notNull(),
    estimateAtAssignment: doublePrecision("estimate_at_assignment").notNull(),
    evidenceCountAtAssignment: integer("evidence_count_at_assignment").notNull(),
    policyVersion: text("policy_version").notNull(),
    teacherNote: text("teacher_note"),
    followUpAssessmentId: uuid("follow_up_assessment_id").references(() => assessments.id, { onDelete: "restrict" }),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    // A student has at most one active intervention per lesson concept.
    uniqueIndex("interventions_one_active_uq").on(t.classId, t.studentId, t.conceptId).where(sql`${t.status} = 'assigned'`),
    index("interventions_class_concept_idx").on(t.classId, t.conceptId),
    index("interventions_student_idx").on(t.studentId, t.assignedAt),
  ],
);

// ---------------------------------------------------------------------------
// Lessons (Phase 4, slice C)
// ---------------------------------------------------------------------------

/** A row means the teacher marked this concept as taught to this class. Unmarking removes it (the audit log keeps the history). */
export const lessonCoverage = pgTable(
  "lesson_coverage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    taughtBy: uuid("taught_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    taughtAt: timestamp("taught_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lesson_coverage_uq").on(t.classId, t.conceptId)],
);

/**
 * One teaching of one lesson to one class on one day: the thread that ties a lesson to its 2-minute check and its
 * wrap-up. The period's state (teaching, checking, needs wrap-up, done) is derived from this row and the check's status.
 */
export const lessonRuns = pgTable(
  "lesson_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    /** Calendar day, YYYY-MM-DD, in the server's local time. */
    runDate: text("run_date").notNull(),
    assessmentId: uuid("assessment_id").references(() => assessments.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    wrappedAt: timestamp("wrapped_at", { withTimezone: true }),
    /** Set while the teacher has paused the running check; device answers are refused until it is cleared. */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("lesson_runs_uq").on(t.classId, t.conceptId, t.runDate), index("lesson_runs_assessment_idx").on(t.assessmentId)],
);

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------

/** One period in a class's weekly timetable. weekday: 1 = Monday … 6 = Saturday. */
export const timetableSlots = pgTable(
  "timetable_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    period: smallint("period").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    subject: text("subject").notNull(),
  },
  (t) => [
    uniqueIndex("timetable_slots_uq").on(t.classId, t.weekday, t.period),
    check("timetable_weekday", sql`${t.weekday} between 1 and 6`),
  ],
);

// ---------------------------------------------------------------------------
// AI (Phase 5)
// ---------------------------------------------------------------------------

export const aiRunStatusEnum = pgEnum("ai_run_status", ["ok", "failed"]);

/**
 * One row per AI call: what ran, how long it took, and how it ended. No prompts and no student data
 * are stored here, only operational metadata (CLAUDE.md §12), so cost and failures are visible.
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    workflow: text("workflow").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "set null" }),
    status: aiRunStatusEnum("status").notNull(),
    errorCode: text("error_code"),
    durationMs: integer("duration_ms").notNull(),
    attempts: integer("attempts").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_runs_user_idx").on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Syllabus -> concept graph (Phase 5, slice B)
// ---------------------------------------------------------------------------

export const proposalStatusEnum = pgEnum("proposal_status", ["draft", "published", "discarded"]);
export const edgeGroundingEnum = pgEnum("edge_grounding", ["document", "inferred", "teacher"]);
export const edgeConfidenceEnum = pgEnum("edge_confidence", ["high", "medium", "low"]);
export const edgeDecisionEnum = pgEnum("edge_decision", ["pending", "accepted", "rejected"]);

/** An uploaded (or pasted) syllabus. The text is untrusted input: it is only ever passed to the AI as fenced data. */
export const syllabusDocuments = pgTable(
  "syllabus_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    originalFilename: text("original_filename").notNull(),
    fileType: text("file_type").notNull(),
    contentHash: text("content_hash").notNull(),
    /** Key in private file storage. Never exposed through a URL. */
    storageKey: text("storage_key"),
    extractedText: text("extracted_text").notNull(),
    pageCount: integer("page_count"),
    /** True when the text contained wording that looks like instructions to an AI. It was still treated as plain data. */
    suspicious: boolean("suspicious").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("syllabus_owner_hash_uq").on(t.uploadedBy, t.contentHash)],
);

export const graphProposals = pgTable(
  "graph_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => syllabusDocuments.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: proposalStatusEnum("status").notNull().default("draft"),
    title: text("title").notNull(),
    board: text("board").notNull(),
    academicYear: text("academic_year").notNull(),
    grade: integer("grade").notNull(),
    subjectName: text("subject_name").notNull(),
    language: text("language").notNull().default("en"),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    /** What our own checks changed or dropped (cycles broken, unknown references, caps). Shown to the teacher. */
    notes: jsonb("notes").$type<string[]>().notNull(),
    publishedVersionId: uuid("published_version_id").references(() => curriculumVersions.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("proposals_creator_idx").on(t.createdBy, t.createdAt)],
);

export const proposalConcepts = pgTable(
  "proposal_concepts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => graphProposals.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    learningObjective: text("learning_objective").notNull(),
    /** Passage from the document that supports this concept, when the AI gave one that really is in the document. */
    evidenceQuote: text("evidence_quote"),
    grounded: boolean("grounded").notNull(),
    position: integer("position").notNull(),
    addedByTeacher: boolean("added_by_teacher").notNull().default(false),
  },
  (t) => [uniqueIndex("proposal_concepts_key_uq").on(t.proposalId, t.key)],
);

export const proposalEdges = pgTable(
  "proposal_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => graphProposals.id, { onDelete: "cascade" }),
    prerequisiteConceptId: uuid("prerequisite_concept_id")
      .notNull()
      .references(() => proposalConcepts.id, { onDelete: "cascade" }),
    dependentConceptId: uuid("dependent_concept_id")
      .notNull()
      .references(() => proposalConcepts.id, { onDelete: "cascade" }),
    evidenceQuote: text("evidence_quote"),
    grounding: edgeGroundingEnum("grounding").notNull(),
    confidence: edgeConfidenceEnum("confidence").notNull(),
    decision: edgeDecisionEnum("decision").notNull(),
  },
  (t) => [
    uniqueIndex("proposal_edges_pair_uq").on(t.proposalId, t.prerequisiteConceptId, t.dependentConceptId),
    check("proposal_edges_no_self", sql`${t.prerequisiteConceptId} <> ${t.dependentConceptId}`),
  ],
);

export type UserRow = typeof users.$inferSelect;

// ---------------------------------------------------------------------------
// Paper-to-insight (Phase 6)
// ---------------------------------------------------------------------------

export const submissionStatusEnum = pgEnum("submission_status", ["uploaded", "needs_review", "approved", "rejected"]);
export const extractionStatusEnum = pgEnum("extraction_status", ["ok", "failed"]);

/** A photographed paper sheet. The image is private: it lives in file storage under a random key and is only streamed to the owning teacher. */
export const submissionFiles = pgTable(
  "submission_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "restrict" }),
    /** Null once the image has been deleted (retention policy or teacher request). */
    storageKey: text("storage_key"),
    fileType: text("file_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    contentHash: text("content_hash").notNull(),
    metadataStripped: boolean("metadata_stripped").notNull().default(false),
    status: submissionStatusEnum("status").notNull().default("uploaded"),
    /** The attempt created when the teacher approved this sheet. */
    attemptId: uuid("attempt_id").references(() => assessmentAttempts.id, { onDelete: "restrict" }),
    /** When the image will be deleted automatically. Set once the sheet is approved or rejected. */
    deleteAfter: timestamp("delete_after", { withTimezone: true }),
    imageDeletedAt: timestamp("image_deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live sheet per student per activity; a rejected one can be replaced.
    uniqueIndex("submission_live_uq").on(t.assessmentId, t.studentId).where(sql`${t.status} <> 'rejected'`),
    index("submission_assessment_idx").on(t.assessmentId, t.createdAt),
    index("submission_delete_after_idx").on(t.deleteAfter),
  ],
);

/** What the reader (vision model) saw. Immutable: a new run adds a row. Reading is never evaluation. */
export const extractionResults = pgTable(
  "extraction_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionFileId: uuid("submission_file_id")
      .notNull()
      .references(() => submissionFiles.id, { onDelete: "restrict" }),
    extractor: text("extractor").notNull(),
    processingVersion: text("processing_version").notNull(),
    status: extractionStatusEnum("status").notNull(),
    errorCode: text("error_code"),
    items: jsonb("items").$type<Array<{ questionId: string; reading: Record<string, unknown>; legibility: string; note: string | null }>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("extraction_file_idx").on(t.submissionFileId, t.createdAt)],
);

/** The teacher's corrections and decision on one sheet. Only an approved review turns paper into evidence. */
export const evaluationReviews = pgTable(
  "evaluation_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionFileId: uuid("submission_file_id")
      .notNull()
      .references(() => submissionFiles.id, { onDelete: "restrict" }),
    extractionResultId: uuid("extraction_result_id").references(() => extractionResults.id, { onDelete: "restrict" }),
    items: jsonb("items").$type<Array<{ questionId: string; reading: Record<string, unknown>; confirmed: boolean }>>().notNull(),
    reviewedBy: uuid("reviewed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("review_file_uq").on(t.submissionFileId)],
);

// ---------------------------------------------------------------------------
// Offline packs and synchronisation (Phase 7)
// ---------------------------------------------------------------------------

export const syncStatusEnum = pgEnum("sync_status", ["applied", "conflict", "rejected", "discarded"]);

/** A lesson pack a teacher prepared while connected. `contentHash` is the version that offline work is tied to. */
export const offlinePacks = pgTable(
  "offline_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("packs_class_idx").on(t.classId, t.createdAt)],
);

/**
 * Every operation a device has sent. The idempotency key is unique, so a retried operation can never be applied twice.
 * Conflicts stay here, with their payload, until a teacher resolves them.
 */
export const syncOperations = pgTable(
  "sync_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: text("idempotency_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    operationType: text("operation_type").notNull(),
    baseVersion: text("base_version").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: syncStatusEnum("status").notNull(),
    reasonCode: text("reason_code"),
    message: text("message"),
    attemptId: uuid("attempt_id").references(() => assessmentAttempts.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sync_ops_key_uq").on(t.idempotencyKey), index("sync_ops_user_idx").on(t.userId, t.status)],
);

// ---------------------------------------------------------------------------
// Teaching briefs (Phase 8)
// ---------------------------------------------------------------------------

/** A generated brief. Items are built from queries, so each line can name the records behind it. */
export const teachingBriefs = pgTable(
  "teaching_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    basis: jsonb("basis").$type<{ students: number; conceptsWithEvidence: number; answersRecorded: number }>().notNull(),
    items: jsonb("items").$type<Array<Record<string, unknown>>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("briefs_class_idx").on(t.classId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Quick polls (class-level pulse; never assessment evidence)
// ---------------------------------------------------------------------------

export const pollKindEnum = pgEnum("poll_kind", ["choice", "true_false", "confidence", "short_answer"]);
export const pollStatusEnum = pgEnum("poll_status", ["open", "closed"]);

/**
 * A one-question pulse of the class. Kept apart from `assessments` on purpose: a poll is not scored and never becomes
 * mastery evidence, so none of the evidence, review or mastery code can touch it.
 */
export const classPolls = pgTable(
  "class_polls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "restrict" }),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: pollKindEnum("kind").notNull(),
    prompt: text("prompt").notNull(),
    options: jsonb("options").$type<Array<{ id: string; text: string }>>().notNull(),
    /** Short answer only; shown to the teacher, never to students. */
    expectedAnswer: text("expected_answer"),
    status: pollStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("class_polls_class_idx").on(t.classId, t.createdAt),
    // One open poll per class, so a student's screen is never ambiguous.
    uniqueIndex("class_polls_one_open_per_class_uq").on(t.classId).where(sql`${t.status} = 'open'`),
  ],
);

/**
 * One answer per student per poll. The student id exists only to stop double answers; no teacher-facing query returns it,
 * so the teacher sees counts, not who chose what.
 */
export const pollVotes = pgTable(
  "poll_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => classPolls.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentProfiles.id, { onDelete: "restrict" }),
    /** Set for a choice; null for a typed answer. */
    optionId: text("option_id"),
    /** Set for a typed (short) answer; null for a choice. */
    answerText: text("answer_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("poll_votes_poll_student_uq").on(t.pollId, t.studentId),
    check("poll_votes_one_kind_ck", sql`(${t.optionId} is null) <> (${t.answerText} is null)`),
  ],
);

// ---------------------------------------------------------------------------
// Agentic workflows: one row per run, one row per tool step (the visible trace)
// ---------------------------------------------------------------------------

export const agentKindEnum = pgEnum("agent_kind", ["intervention_planner", "lesson_prep", "check_followup"]);
export const agentRunStatusEnum = pgEnum("agent_run_status", ["running", "awaiting_approval", "approved", "rejected", "failed"]);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent: agentKindEnum("agent").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "restrict" }),
    patternId: uuid("pattern_id").references(() => misconceptionPatterns.id, { onDelete: "restrict" }),
    status: agentRunStatusEnum("status").notNull().default("running"),
    /** The validated plan, once the agent finishes. */
    plan: jsonb("plan").$type<Record<string, unknown>>(),
    /** Pseudonym (S1 …) to student id. Server-side only; never sent to the model. */
    pseudonyms: jsonb("pseudonyms").$type<Record<string, string>>().notNull().default({}),
    error: text("error"),
    outcome: jsonb("outcome").$type<{ message: string; links: Array<{ label: string; href: string }> }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("agent_runs_class_idx").on(t.classId, t.createdAt)],
);

export const agentSteps = pgTable(
  "agent_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    reason: text("reason").notNull(),
    tool: text("tool").notNull(),
    args: jsonb("args").$type<Record<string, unknown>>().notNull(),
    observation: text("observation").notNull(),
    ok: boolean("ok").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_steps_run_idx").on(t.runId, t.stepIndex)],
);
