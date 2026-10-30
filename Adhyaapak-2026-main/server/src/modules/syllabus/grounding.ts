/**
 * Quotes from the AI are only trusted if they really occur in the document. Comparison ignores
 * case, punctuation, quote styles and line breaks, which PDFs and models both change freely.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A quote must be long enough to mean something; a few common words would match almost any document. */
export const MIN_QUOTE_CHARS = 15;

export function quoteIsInDocument(quote: string | null | undefined, normalizedDocument: string): quote is string {
  if (!quote) return false;
  const q = normalizeForMatch(quote);
  return q.length >= MIN_QUOTE_CHARS && normalizedDocument.includes(q);
}

/**
 * Wording that looks like an instruction to an AI. Finding some does not stop processing (the text is
 * always treated as data), but the teacher is told, because a document that tries to give orders to
 * an AI is worth a second look.
 */
const INSTRUCTION_PATTERNS: RegExp[] = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules|messages)/i,
  /disregard (all |any |the )?(previous|prior|above|earlier)? ?(instructions|prompts?|rules)/i,
  /\b(new|updated) instructions?\b/i,
  /\bsystem prompt\b/i,
  /\byou are (now )?(an? )?(ai|assistant|chatbot|admin|administrator|developer)\b/i,
  /\b(reveal|print|show|output) (your|the) (prompt|instructions|api key|secret)/i,
  /\bact as (an? )?(admin|administrator|root|developer)\b/i,
  /\bpretend (to be|you are)\b/i,
];

export function looksLikeInstructions(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((p) => p.test(text));
}
