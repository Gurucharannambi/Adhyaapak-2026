import type { AppConfig } from "../../config";
import type { Db } from "../../db/client";
import { AppError } from "../../http/errors";
import { registerTeacher } from "./auth.service";

/**
 * Optional demo sign-in for local development and demos: when DEMO_LOGIN_EMAIL and DEMO_LOGIN_PASSWORD are both set,
 * the sign-in page offers a button that fills them in. The credentials are public by design, so this is never
 * available when NODE_ENV is "production".
 */
export function demoLogin(config: Pick<AppConfig, "NODE_ENV" | "DEMO_LOGIN_EMAIL" | "DEMO_LOGIN_PASSWORD">): { email: string; password: string } | null {
  if (config.NODE_ENV === "production") return null;
  if (!config.DEMO_LOGIN_EMAIL || !config.DEMO_LOGIN_PASSWORD) return null;
  return { email: config.DEMO_LOGIN_EMAIL, password: config.DEMO_LOGIN_PASSWORD };
}

/** Creates the demo teacher if it does not exist yet, so the button always works. Safe to call on every start. */
export async function ensureDemoTeacher(db: Db, config: AppConfig): Promise<boolean> {
  const demo = demoLogin(config);
  if (!demo) return false;
  try {
    await registerTeacher(db, { name: "Demo Teacher", email: demo.email.toLowerCase(), password: demo.password });
    return true;
  } catch (err) {
    if (err instanceof AppError && err.status === 409) return false; // already there
    throw err;
  }
}
