import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ApiError } from "@adhyaapak/shared";
import { AppError } from "./errors";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError("not_found", `No route for ${req.method} ${req.path}.`));
};

/** Single place errors become responses. Internals (stack traces, SQL, provider text) never leave the server. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = String(req.id ?? "unknown");

  let appError: AppError;
  if (err instanceof AppError) {
    appError = err;
  } else if (err && typeof err === "object" && (err as { type?: string }).type === "entity.parse.failed") {
    appError = new AppError("validation_error", "The request body is not valid JSON.");
  } else if (err && typeof err === "object" && (err as { type?: string }).type === "entity.too.large") {
    appError = new AppError("validation_error", "The request is too large.");
  } else {
    appError = new AppError("internal_error", "Something went wrong on our side. Please try again.");
    req.log.error({ err }, "unhandled error");
  }

  const body: ApiError = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
    requestId,
  };
  res.status(appError.status).json(body);
};
