import { hash, verify } from "@node-rs/argon2";

// argon2id with the library defaults (OWASP-recommended class of parameters).
export const hashPassword = (plain: string): Promise<string> => hash(plain);

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

/** Hash of a throwaway string, verified against when the email is unknown so timing does not reveal which emails exist. */
let dummyHash: Promise<string> | undefined;
export const getDummyHash = (): Promise<string> => (dummyHash ??= hash("not-a-real-password"));
