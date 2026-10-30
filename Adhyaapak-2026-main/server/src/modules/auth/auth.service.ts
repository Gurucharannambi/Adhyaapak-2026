import { sql } from "drizzle-orm";
import type { LoginRequest, RegisterRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { users } from "../../db/schema";
import { AppError, conflict } from "../../http/errors";
import { getDummyHash, hashPassword, verifyPassword } from "./password";

const GENERIC_LOGIN_FAILURE = "Invalid email or password.";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: "teacher" | "student" | "admin";
}

/** Self-registration creates teachers only. Students are created by teachers; admins by seeding. */
export async function registerTeacher(db: Db, input: RegisterRequest): Promise<AuthenticatedUser> {
  const passwordHash = await hashPassword(input.password);
  try {
    const [row] = await db
      .insert(users)
      .values({ name: input.name, email: input.email, passwordHash, role: "teacher" })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role });
    return row!;
  } catch (err) {
    // 23505 = unique_violation on the lower(email) index.
    // Drizzle wraps the driver error, so the Postgres code may be on `cause`.
    const pgCode = (e: unknown) => (typeof e === "object" && e ? (e as { code?: string }).code : undefined);
    if (pgCode(err) === "23505" || pgCode((err as { cause?: unknown }).cause) === "23505") {
      throw conflict("An account with this email already exists.");
    }
    throw err;
  }
}

export async function verifyCredentials(db: Db, input: LoginRequest): Promise<AuthenticatedUser> {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${input.email}`)
    .limit(1);

  // Always run one verification so response time does not reveal whether the email exists.
  const ok = await verifyPassword(row?.passwordHash ?? (await getDummyHash()), input.password);
  if (!row || !ok || row.status !== "active") {
    throw new AppError("unauthenticated", GENERIC_LOGIN_FAILURE);
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}
