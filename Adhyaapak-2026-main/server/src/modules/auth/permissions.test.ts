import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../http/errors";
import { requireRole } from "./middleware";
import { assertCanViewUser, canViewUser } from "./permissions";

describe("canViewUser", () => {
  it("lets users view themselves and admins view anyone, but not other users", () => {
    expect(canViewUser({ id: "a", role: "student" }, "a")).toBe(true);
    expect(canViewUser({ id: "a", role: "student" }, "b")).toBe(false);
    expect(canViewUser({ id: "t", role: "teacher" }, "b")).toBe(false);
    expect(canViewUser({ id: "x", role: "admin" }, "b")).toBe(true);
  });

  it("assert throws a 403 AppError", () => {
    expect(() => assertCanViewUser({ id: "a", role: "student" }, "b")).toThrow(AppError);
  });
});

describe("requireRole", () => {
  const run = (user: Request["user"], ...roles: Parameters<typeof requireRole>) => {
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
    requireRole(...roles)({ user } as Request, {} as Response, next);
    return next as ReturnType<typeof vi.fn>;
  };

  it("allows a permitted role", () => {
    expect(run({ id: "1", name: "T", email: "t@x.co", role: "teacher" }, "teacher")).toHaveBeenCalledWith();
  });

  it("blocks a student from a teacher route", () => {
    const next = run({ id: "2", name: "S", email: "s@x.co", role: "student" }, "teacher");
    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "forbidden", status: 403 });
  });

  it("blocks anonymous callers with 401", () => {
    const next = run(undefined, "teacher");
    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "unauthenticated", status: 401 });
  });
});
