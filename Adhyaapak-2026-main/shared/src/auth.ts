import { z } from "zod";
import { Id, Role } from "./common";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
/** Length over complexity rules (NIST guidance). Upper bound stops hash-DoS. */
const password = z.string().min(10, "Use at least 10 characters").max(128);

export const RegisterRequest = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  password,
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** The only user shape the API returns. Never includes the password hash. */
export const UserDto = z.object({
  id: Id,
  name: z.string(),
  email: z.string(),
  role: Role,
});
export type UserDto = z.infer<typeof UserDto>;

export const AuthResponse = z.object({ user: UserDto });
export type AuthResponse = z.infer<typeof AuthResponse>;

/** Public, non-secret config the client needs at startup. */
export const PublicConfig = z.object({
  appName: z.string(),
  aiEnabled: z.boolean(),
  /** Present only when the server offers a public demo sign-in (development and demos, never production). */
  demoLogin: z.object({ email: z.string(), password: z.string() }).optional(),
});
export type PublicConfig = z.infer<typeof PublicConfig>;
