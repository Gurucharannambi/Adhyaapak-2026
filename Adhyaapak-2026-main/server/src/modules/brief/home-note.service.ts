import { and, asc, eq, inArray } from "drizzle-orm";
import type { HomeNoteDto } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { classEnrolments, conceptMastery, concepts, questions, studentProfiles } from "../../db/schema";
import { notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { loadAccessibleClass } from "../classes/class.access";

/**
 * A plain-language page for a family. It says what is going well and what to practise at home, with a few
 * practice questions (no answers, so no one is marked). It carries no diagnostic labels, no scores, no rank and
 * no comparison, and uses the first name only. The teacher prints it, so they read it first.
 */
export async function getHomeNote(db: Db, actor: Actor, classId: string, studentId: string): Promise<HomeNoteDto> {
  const cls = await loadAccessibleClass(db, actor, classId);
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) throw notFound("Student not found.");
  const [member] = await db
    .select({ name: studentProfiles.name })
    .from(classEnrolments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
    .where(and(eq(classEnrolments.classId, cls.id), eq(classEnrolments.studentId, studentId), eq(classEnrolments.status, "active")));
  if (!member) throw notFound("Student not found.");

  const rows = await db
    .select({ conceptId: concepts.id, title: concepts.title, status: conceptMastery.status })
    .from(conceptMastery)
    .innerJoin(concepts, eq(concepts.id, conceptMastery.conceptId))
    .where(eq(conceptMastery.studentId, studentId))
    .orderBy(asc(concepts.conceptOrder));

  const goingWell = rows.filter((r) => r.status === "likely_secure" || r.status === "ready_for_challenge").map((r) => r.title);
  const practiseConcepts = rows.filter((r) => r.status === "developing" || r.status === "needs_foundation").slice(0, 3);
  const stems = practiseConcepts.length
    ? await db
        .select({ conceptId: questions.conceptId, stem: questions.stem, difficulty: questions.difficulty, key: questions.key })
        .from(questions)
        .where(and(inArray(questions.conceptId, practiseConcepts.map((c) => c.conceptId)), eq(questions.reviewStatus, "approved")))
        .orderBy(asc(questions.difficulty), asc(questions.key))
    : [];

  const first = member.name.trim().split(/\s+/)[0] ?? member.name;
  return {
    studentFirstName: first,
    className: cls.name,
    goingWell,
    practise: practiseConcepts.map((c) => ({ topic: c.title, tryThese: stems.filter((s) => s.conceptId === c.conceptId && s.difficulty <= 3).slice(0, 3).map((s) => s.stem) })),
    note:
      rows.length === 0
        ? `We have not had enough work from ${first} yet to say much. Please encourage ${first} to keep trying.`
        : `A few minutes of practice, a little each day, helps most. Ask ${first} to explain how they got each answer in their own words: the explaining is the learning.`,
  };
}
