import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, users } from "../../db/schema";
import { buildTestApp, resetDb, validTeacher } from "../../test/helpers";

const { app, db, pool } = buildTestApp();

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const register = (body: object = validTeacher) => request(app).post("/api/v1/auth/register").send(body);

describe("registration", () => {
  it("creates a teacher, signs them in, and never returns the password hash", async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: "Asha Rao", email: "asha@example.com", role: "teacher" });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|argon/i);

    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("stores an argon2id hash, never the plaintext password", async () => {
    await register();
    const [row] = await db.select().from(users);
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row!.passwordHash).not.toContain(validTeacher.password);
  });

  it("rejects a duplicate email regardless of letter case", async () => {
    await register();
    const res = await register({ ...validTeacher, email: "ASHA@Example.com" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("conflict");
  });

  it("rejects short passwords and bad emails with field-level details", async () => {
    const res = await register({ name: "X", email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["email", "password"]));
  });

  it("does not let a caller choose their own role", async () => {
    const res = await register({ ...validTeacher, role: "admin" });
    expect(res.body.user.role).toBe("teacher");
  });
});

describe("login, session and logout", () => {
  it("logs in and reaches a protected route with the session cookie", async () => {
    await register();
    const agent = request.agent(app);
    const login = await agent.post("/api/v1/auth/login").send({ email: "Asha@Example.com", password: validTeacher.password });
    expect(login.status).toBe(200);

    const me = await agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("asha@example.com");
  });

  it("gives the same generic failure for a wrong password and an unknown email", async () => {
    await register();
    const wrongPassword = await request(app).post("/api/v1/auth/login").send({ email: validTeacher.email, password: "wrong-password-1" });
    const unknownEmail = await request(app).post("/api/v1/auth/login").send({ email: "nobody@example.com", password: "wrong-password-1" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it("rejects protected routes without a session", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
  });

  it("ends the session on logout so the old cookie stops working", async () => {
    const agent = request.agent(app);
    const reg = await agent.post("/api/v1/auth/register").send(validTeacher);
    const cookie = (reg.headers["set-cookie"]?.[0] ?? "").split(";")[0]!;
    expect((await agent.post("/api/v1/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);

    // Replaying the pre-logout cookie must also fail (server-side invalidation, not just cookie removal).
    const stale = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(stale.status).toBe(401);
  });

  it("blocks a disabled user even with a valid session", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").send(validTeacher);
    await db.update(users).set({ status: "disabled" });
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("writes audit records without leaking the email or password", async () => {
    await register();
    await request(app).post("/api/v1/auth/login").send({ email: validTeacher.email, password: "wrong-password-1" });
    const rows = await db.select().from(auditLog);
    expect(rows.map((r) => r.action).sort()).toEqual(["auth.login_failed", "auth.register"]);
    expect(JSON.stringify(rows)).not.toContain("wrong-password-1");
    expect(JSON.stringify(rows.find((r) => r.action === "auth.login_failed"))).not.toContain(validTeacher.email);
  });
});

describe("request safety and error handling", () => {
  it("rejects state-changing requests from a foreign origin (CSRF)", async () => {
    const res = await request(app).post("/api/v1/auth/login").set("Origin", "https://evil.example").send({ email: "a@b.co", password: "x" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("accepts requests from the configured app origin", async () => {
    const res = await request(app).post("/api/v1/auth/login").set("Origin", "http://localhost:5173").send({ email: "a@b.co", password: "x" });
    expect(res.status).toBe(401);
  });

  it("returns a consistent error envelope with a request id, and 404 for unknown routes", async () => {
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "not_found" } });
    expect(typeof res.body.requestId).toBe("string");
    expect(res.headers["x-request-id"]).toBe(res.body.requestId);
  });

  it("returns a safe validation error for malformed JSON", async () => {
    const res = await request(app).post("/api/v1/auth/login").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("reports health and public config", async () => {
    expect((await request(app).get("/api/v1/health")).body).toEqual({ status: "ok", database: "up" });
    const cfg = await request(app).get("/api/v1/config");
    expect(cfg.body).toEqual({ appName: "Adhyaapak", aiEnabled: expect.any(Boolean) });
    expect(JSON.stringify(cfg.body)).not.toMatch(/key|secret/i);
  });
});
