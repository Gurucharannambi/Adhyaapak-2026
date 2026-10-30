import type { z } from "zod";
import { AppError } from "./errors";

/** Parse untrusted input with a Zod schema, turning failures into a 400 with field-level details. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new AppError(
    "validation_error",
    "Some fields need attention.",
    result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}
