/**
 * Demo activity for the DEMO account only (DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD in .env).
 *
 * Runs a few class checks through the running API exactly as a teacher would (create, approve, open, key answers from
 * paper, close), so evidence, mastery, misconception observations and audit entries all come from the real pipeline.
 * Every check it creates is titled "Demo data: …" so it is never mistaken for a real classroom record, and it refuses
 * to run twice for the same class. It never touches any other account.
 *
 *   npm run db:seed-demo -w server        (with the API running on API_URL, default http://localhost:4000)
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Same .env as the server (repo root), so the demo account is the one the app offers on its sign-in page.
const envFile = resolve(import.meta.dirname, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const API = `${process.env.API_URL ?? "http://localhost:4000"}/api/v1`;
const email = process.env.DEMO_LOGIN_EMAIL;
const password = process.env.DEMO_LOGIN_PASSWORD;
const TAG = "Demo data:";

let cookie = "";
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

type Option = { id: string; text: string; misconceptionKey?: string | null };
type Question = { id: string; conceptId: string; correctOptionId: string; options: Option[] };

/** How each demo student answers, by roster position. Deterministic, so a re-seed of a fresh database gives the same picture. */
type Profile = "secure" | "improving" | "pattern" | "mixed" | "absent_first";
const PROFILES: Profile[] = ["secure", "improving", "pattern", "mixed", "secure", "absent_first"];

function choose(q: Question, profile: Profile, round: number, i: number): string | null {
  const tagged = q.options.find((o) => o.misconceptionKey && o.id !== q.correctOptionId);
  const wrong = tagged ?? q.options.find((o) => o.id !== q.correctOptionId)!;
  switch (profile) {
    case "secure":
      return q.correctOptionId;
    case "improving":
      return round === 0 ? wrong.id : q.correctOptionId;
    case "pattern":
      return round === 0 || i % 2 === 0 ? wrong.id : q.correctOptionId;
    case "mixed":
      return (round + i) % 2 === 0 ? q.correctOptionId : wrong.id;
    case "absent_first":
      return round === 0 ? null : q.correctOptionId;
  }
}

async function main() {
  if (!email || !password) throw new Error("Set DEMO_LOGIN_EMAIL and DEMO_LOGIN_PASSWORD in .env first. This script only works on the demo account.");
  await call("POST", "/auth/login", { email, password });
  const { classes } = await call<{ classes: Array<{ id: string; name: string; studentCount: number; joinCode: string }> }>("GET", "/classes");
  const cls = [...classes].sort((a, b) => b.studentCount - a.studentCount)[0];
  if (!cls || cls.studentCount === 0) throw new Error("The demo account needs a class with students first.");
  const { assessments: existing } = await call<{ assessments: Array<{ title: string }> }>("GET", `/classes/${cls.id}/assessments`);
  if (existing.some((a) => a.title.startsWith(TAG))) {
    console.log(`Demo checks already exist for ${cls.name} (${cls.joinCode}). Nothing to do.`);
    return;
  }
  const { students } = await call<{ students: Array<{ id: string; name: string; rosterNumber: number }> }>("GET", `/classes/${cls.id}/students`);
  const { curricula } = await call<{ curricula: Array<{ id: string; grade: number }> }>("GET", "/curriculum");
  const version = curricula.find((c) => c.grade === 6) ?? curricula[0];
  if (!version) throw new Error("No curriculum found. Run npm run db:seed first.");
  const { chapters } = await call<{ chapters: Array<{ id: string; title: string }> }>("GET", `/curriculum/${version.id}/chapters`);
  const { concepts } = await call<{ concepts: Array<{ id: string; title: string }> }>("GET", `/chapters/${chapters[0]!.id}/concepts`);

  let made = 0;
  for (const concept of concepts.slice(0, 5)) {
    const { questions } = await call<{ questions: Question[] }>("POST", `/classes/${cls.id}/assessments/suggest`, { mode: "diagnostic", conceptIds: [concept.id], count: 4 }).catch(() => ({ questions: [] as Question[] }));
    if (questions.length < 2) continue;
    // Two checks per concept, on different questions, so "repeated" evidence and change between checks are real.
    for (const round of [0, 1]) {
      const qs = round === 0 ? questions.slice(0, 2) : questions.slice(2, 4).length ? questions.slice(2, 4) : questions.slice(0, 2);
      const a = await call<{ id: string }>("POST", `/classes/${cls.id}/assessments`, { title: `${TAG} ${concept.title} (${round === 0 ? "first" : "second"} check)`, type: "diagnostic", questionIds: qs.map((q) => q.id) });
      await call("POST", `/assessments/${a.id}/status`, { to: "approved" });
      await call("POST", `/assessments/${a.id}/status`, { to: "open" });
      const detail = await call<{ questions: Question[] }>("GET", `/assessments/${a.id}`);
      const entries = students
        .map((s, idx) => {
          const profile = PROFILES[idx % PROFILES.length]!;
          const answers = detail.questions
            .map((q, i) => ({ q, choice: choose(q, profile, round, i) }))
            .filter((x) => x.choice)
            .map(({ q, choice }) => ({ questionId: q.id, answer: { kind: "option", optionId: choice } }));
          return { studentId: s.id, answers };
        })
        .filter((e) => e.answers.length > 0);
      if (entries.length) await call("POST", `/assessments/${a.id}/entry`, { entries });
      await call("POST", `/assessments/${a.id}/status`, { to: "closed" });
      made++;
    }
    console.log(`  ${concept.title}: 2 checks`);
  }
  console.log(`Created ${made} demo checks for ${cls.name} (${cls.joinCode}). Each is titled "${TAG} …".`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
