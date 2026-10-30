import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, resetDb, signedInAgent } from "../test/helpers";
import { seedFractionsClass6 } from "../modules/curriculum/seed/seed";

const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

/** Every route the app serves, found by walking Express's own routing tables (so a new route is automatically covered). */
function allRoutes(): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) for (const m of Object.keys(layer.route.methods)) out.push({ method: m.toUpperCase(), path: prefix + layer.route.path });
      else if (layer.handle?.stack) walk(layer.handle.stack, prefix);
    }
  };
  // The API router is mounted at /api/v1 (see app.ts); routers inside it add no further prefix.
  for (const layer of (app as unknown as { router: { stack: Layer[] } }).router.stack) {
    if (layer.route) walk([layer], "");
    else if (layer.handle?.stack) walk(layer.handle.stack, "/api/v1");
  }
  // The auth router is mounted at /auth (app.ts); Express keeps that prefix out of the routes inside it.
  return out.map((r) => ({ ...r, path: r.path.replace(/^\/api\/v1\/(register|login|logout|me)$/, "/api/v1/auth/$1") }));
}

/** Routes that are meant to be reachable without signing in. Everything else must refuse an anonymous caller. */
const PUBLIC = new Set([
  "GET /api/v1/health",
  "GET /api/v1/config",
  "POST /api/v1/auth/register",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/logout",
  "POST /api/v1/join", // students join with a class code and number; rate limited
  "POST /api/v1/student/leave", // ends the caller's own session, harmless without one
]);

const ID = "00000000-0000-4000-8000-000000000001";
const concretePath = (p: string) => p.replace(/:[A-Za-z]+/g, ID);

beforeAll(async () => {
  await resetDb(db);
  await seedFractionsClass6(db);
});

describe("route security sweep", () => {
  const routes = allRoutes();

  it("finds the app's routes", () => {
    expect(routes.length).toBeGreaterThan(80);
    expect(routes.some((r) => r.path === "/api/v1/sync/operations")).toBe(true);
    expect(routes.some((r) => r.path === "/api/v1/student/practice")).toBe(true);
  });

  it("every route that is not on the public list refuses an anonymous caller with 401", async () => {
    const open: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key)) continue;
      const res = await request(app)[r.method.toLowerCase() as "get"](concretePath(r.path)).send({});
      if (res.status !== 401) open.push(`${key} -> ${res.status}`);
    }
    expect(open, "These routes answered an anonymous request. Protect them or add them to the public list on purpose.").toEqual([]);
  });

  it("no teacher route accepts a student's session, and no student route accepts a teacher's", async () => {
    const teacher = await signedInAgent(app);
    const cls = (await teacher.post("/api/v1/classes").send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
    await teacher.post(`/api/v1/classes/${cls.id}/students`).send({ name: "Ravi" });
    await teacher.patch(`/api/v1/classes/${cls.id}`).send({ portalEnabled: true });
    const student = request.agent(app);
    expect((await student.post("/api/v1/join").send({ joinCode: cls.joinCode, rosterNumber: 1 })).status).toBe(200);

    const wrong: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key)) continue;
      const method = r.method.toLowerCase() as "get";
      const isStudentRoute = r.path.startsWith("/api/v1/student/");
      if (!isStudentRoute) {
        const res = await student[method](concretePath(r.path)).send({});
        if (res.status !== 401 && res.status !== 403) wrong.push(`student session on ${key} -> ${res.status}`);
      } else {
        const res = await teacher[method](concretePath(r.path)).send({});
        if (res.status !== 401) wrong.push(`teacher session on ${key} -> ${res.status}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("a signed-in teacher gets 404 (never 200 or 500) on every id-based route for things that do not exist", async () => {
    const teacher = await signedInAgent(app, "sweep@example.com", "Sweep");
    const bad: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key) || r.path.startsWith("/api/v1/student/") || !r.path.includes(":")) continue;
      // Skip routes whose first parameter is not a stored thing (these have their own tests).
      if (/\/paper-accuracy$|\/syllabus-documents\/text$/.test(r.path)) continue;
      const res = await teacher[r.method.toLowerCase() as "get"](concretePath(r.path)).send({});
      if (res.status >= 500) bad.push(`${key} -> ${res.status}`);
      if (res.status === 200) bad.push(`${key} answered 200 for an id that does not exist`);
    }
    expect(bad).toEqual([]);
  });
});
