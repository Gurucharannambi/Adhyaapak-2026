import { describe, expect, it } from "vitest";
import { createLogger, safeError } from "./logger";

function capture() {
  const lines: string[] = [];
  const logger = createLogger({ LOG_LEVEL: "info", NODE_ENV: "test" }, { write: (s: string) => void lines.push(s) });
  return { logger, text: () => lines.join("") };
}

describe("logging keeps personal data out", () => {
  it("drops query parameters and row details from database errors", () => {
    const { logger, text } = capture();
    const dbError = Object.assign(new Error('Failed query: insert into "student_profiles" ("name") values ($1)\nparams: Ravi Kumar,ADM-0042'), {
      code: "23502",
      detail: "Failing row contains (Ravi Kumar, ADM-0042).",
      cause: { code: "23502", detail: "Failing row contains (Ravi Kumar)." },
    });
    logger.error({ err: dbError }, "request failed");
    const out = text();
    expect(out).not.toMatch(/Ravi|ADM-0042|Failing row/);
    expect(out).toContain("23502");
    expect(out).toContain("Failed query: insert into");
  });

  it("redacts cookies, authorization headers and secrets", () => {
    const { logger, text } = capture();
    logger.info({ req: { headers: { cookie: "adh_session=SECRET-TOKEN", authorization: "Bearer SECRET-KEY" } }, user: { password: "hunter2", apiKey: "sk-live" } }, "x");
    expect(text()).not.toMatch(/SECRET|hunter2|sk-live/);
  });

  it("handles things that are not errors", () => {
    expect(safeError("plain text")).toEqual({ message: "plain text" });
    expect(safeError(null)).toEqual({ message: "null" });
    expect(safeError(new Error("x"))).toMatchObject({ type: "Error", message: "x" });
  });
});
