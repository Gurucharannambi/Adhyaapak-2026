import { randomInt } from "node:crypto";

// No 0/O/1/I/L so a code read aloud or copied from a board is hard to get wrong.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateJoinCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}
