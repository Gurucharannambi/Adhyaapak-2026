import { sql } from "drizzle-orm";
import { pino } from "pino";
import request from "supertest";
import { createApp } from "../app";
import type { LlmProvider } from "../modules/ai/provider";
import type { StorageProvider } from "../modules/files/storage";
import { loadConfig } from "../config";
import { createDb } from "../db/client";

export function buildTestApp(ai?: LlmProvider, storage?: StorageProvider) {
  const config = loadConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  const app = createApp({ config, db, logger: pino({ level: "silent" }), ...(ai ? { ai } : {}), ...(storage ? { storage } : {}) });
  return { app, db, pool, config };
}

export async function resetDb(db: ReturnType<typeof createDb>["db"]) {
  await db.execute(sql`truncate table
    audit_log, ai_runs, teaching_briefs, sync_operations, offline_packs, evaluation_reviews, extraction_results, submission_files, proposal_edges, proposal_concepts, graph_proposals, syllabus_documents, sessions, student_sessions, interventions, lesson_coverage, misconception_observations, assessment_evidence, concept_mastery, question_responses, assessment_attempts, assessment_questions, assessments, class_enrolments, student_profiles, classes,
    question_concepts, questions, misconception_patterns, learning_resources,
    concept_prerequisites, concepts, chapters, curriculum_versions, subjects,
    users, schools restart identity cascade`);
}

/** Registers a teacher and returns a signed-in agent for that teacher. */
export async function signedInAgent(app: Parameters<typeof request>[0], email = "asha@example.com", name = "Asha Rao") {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/register").send({ name, email, password: validTeacher.password });
  if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
  return agent;
}

export const validTeacher = {
  name: "Asha Rao",
  email: "asha@example.com",
  password: "correct horse battery",
};
