import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { assessmentEvidence, classes, concepts } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { seedBook } from "../curriculum/seed/book";
import { CreatePollRequest, PollVoteRequest } from "@adhyaapak/shared";
import { groupAnswers, valueOf } from "./short-answer";

describe("grouping typed answers (pure)", () => {
  it("reads whole numbers, fractions, mixed numbers and decimals, reduced", () => {
    expect(valueOf("2/4")).toEqual({ n: 1, d: 2 });
    expect(valueOf("0.5")).toEqual({ n: 1, d: 2 });
    expect(valueOf(".25")).toEqual({ n: 1, d: 4 });
    expect(valueOf("1 1/2")).toEqual({ n: 3, d: 2 });
    expect(valueOf("6")).toEqual({ n: 6, d: 1 });
    expect(valueOf("3/0")).toBeUndefined();
    expect(valueOf("half")).toBeUndefined();
  });

  it("puts equal numbers in one group, keeps the other ways they were written, and marks the expected answer", () => {
    const g = groupAnswers(["4/8", "1/2", "2/5", "4/8", "0.5", "2/5", "half", "Half "], "1/2");
    expect(g[0]).toEqual({ label: "4/8", variants: ["1/2", "0.5"], count: 4, matches: true });
    expect(g[1]).toEqual({ label: "2/5", variants: [], count: 2, matches: false });
    // Words are grouped by text only, ignoring case and spaces; they are never guessed to be a number.
    expect(g[2]).toMatchObject({ label: "half", count: 2, matches: false });
  });

  it("says nothing about right or wrong when the teacher gave no expected answer", () => {
    expect(groupAnswers(["3", "three"], null).every((x) => x.matches === null)).toBe(true);
  });

  it("validates typed answers: short and maths-shaped only", () => {
    expect(PollVoteRequest.safeParse({ text: "3/4" }).success).toBe(true);
    expect(PollVoteRequest.safeParse({ text: "<script>" }).success).toBe(false);
    expect(PollVoteRequest.safeParse({ text: "x".repeat(25) }).success).toBe(false);
    expect(PollVoteRequest.safeParse({ text: "3/4", optionId: "a" }).success).toBe(false);
    expect(CreatePollRequest.safeParse({ kind: "short_answer", prompt: "1/2 = ?/8", expectedAnswer: "4/8" }).success).toBe(true);
    expect(CreatePollRequest.safeParse({ kind: "true_false", prompt: "ok then", expectedAnswer: "a" }).success).toBe(false);
  });
});

const API = "/api/v1";
const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());

beforeEach(async () => {
  await resetDb(db);
  await seedBook(db);
});

describe("short-answer questions, live", () => {
  it("collects typed answers once each, groups them for the teacher, and never tells students the expected answer", async () => {
    const teacher = await signedInAgent(app);
    const classId = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body.id as string;
    for (let i = 1; i <= 4; i++) await teacher.post(`${API}/classes/${classId}/students`).send({ name: `Student ${i}` });
    const [concept] = await db.select().from(concepts).where(eq(concepts.key, "equivalent-fractions"));
    const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
    const base = `${API}/classes/${classId}/lessons/${concept!.id}/polls`;

    const started = await teacher.post(base).send({ kind: "short_answer", prompt: "1/2 = ?/8. Write the whole fraction.", expectedAnswer: "4/8" });
    expect(started.status).toBe(201);
    expect(started.body.options).toEqual([]);

    const typed = ["4/8", "2/8", "1/2"];
    for (const [i, text] of typed.entries()) {
      const s = request.agent(app);
      await s.post(`${API}/join`).send({ joinCode: cls!.joinCode, rosterNumber: i + 1 });
      const seen = (await s.get(`${API}/student/activity`)).body;
      expect(seen.poll.answerType).toBe("text");
      expect(JSON.stringify(seen)).not.toContain("4/8"); // the expected answer stays with the teacher
      // A choice is refused for a typed question.
      expect((await s.post(`${API}/student/poll/vote`).send({ optionId: "a" })).status).toBe(400);
      expect((await s.post(`${API}/student/poll/vote`).send({ text })).status).toBe(200);
      // A second answer does not replace or add to the first.
      expect((await s.post(`${API}/student/poll/vote`).send({ text: "9/9" })).status).toBe(200);
    }

    const now = (await teacher.get(`${base}/current`)).body.poll;
    expect(now.answered).toBe(3);
    expect(now.expectedAnswer).toBe("4/8");
    expect(now.answers).toEqual([
      { label: "4/8", variants: ["1/2"], count: 2, matches: true },
      { label: "2/8", variants: [], count: 1, matches: false },
    ]);
    expect(await db.select().from(assessmentEvidence)).toHaveLength(0);
  });
});
