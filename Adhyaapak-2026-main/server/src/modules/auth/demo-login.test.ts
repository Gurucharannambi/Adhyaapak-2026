import { describe, expect, it } from "vitest";
import { demoLogin } from "./demo-login";

const base = { NODE_ENV: "development" as const, DEMO_LOGIN_EMAIL: "demo@example.test", DEMO_LOGIN_PASSWORD: "demo-teacher-2026" };

describe("demoLogin", () => {
  it("offers the credentials only when both are configured", () => {
    expect(demoLogin(base)).toEqual({ email: "demo@example.test", password: "demo-teacher-2026" });
    expect(demoLogin({ ...base, DEMO_LOGIN_PASSWORD: undefined })).toBeNull();
    expect(demoLogin({ ...base, DEMO_LOGIN_EMAIL: undefined })).toBeNull();
  });

  it("is never offered in production", () => {
    expect(demoLogin({ ...base, NODE_ENV: "production" })).toBeNull();
  });
});
