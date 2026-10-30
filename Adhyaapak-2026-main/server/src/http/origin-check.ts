import type { RequestHandler } from "express";
import { AppError } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence alongside SameSite=Lax cookies: browsers always send Origin on cross-site
 * state-changing requests, so reject those that do not come from our own app.
 * Requests without an Origin header (curl, tests, server-to-server) are not browser CSRF vectors.
 */
export function originCheck(allowedOrigin: string): RequestHandler {
  const allowed = new URL(allowedOrigin).origin;
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get("origin");
    if (origin && origin !== allowed) {
      return next(new AppError("forbidden", "This request came from an unexpected origin."));
    }
    next();
  };
}
