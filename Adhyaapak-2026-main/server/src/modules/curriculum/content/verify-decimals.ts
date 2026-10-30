import type { QuestionLike, Verification } from "../../ai/verify-arithmetic";

/**
 * Checks decimal questions with plain arithmetic, in whole thousandths so no floating-point error creeps in:
 *   "a + b = ?"  /  "a − b = ?"  and  "Which is greater: a or b?"  /  "Which is smaller: a or b?"
 * The marked answer must be right and no other option may equal it. Other shapes (word problems, ordering,
 * place value) return "not_applicable": a person must check those.
 */
const SCALE = 1000;

/** Parses "0.25" or "3" to thousandths, or undefined if it is not a plain non-negative decimal with at most 3 places. */
export function parseDecimal(text: string): number | undefined {
  const m = /^\s*(?:₹\s*)?(\d+)(?:\.(\d{1,3}))?\s*$/.exec(text.normalize("NFKC"));
  if (!m) return undefined;
  return Number(m[1]) * SCALE + Number((m[2] ?? "").padEnd(3, "0"));
}

const na: Verification = { status: "not_applicable", issues: [] };

export function verifyDecimalArithmetic(q: QuestionLike): Verification {
  const stem = q.stem.normalize("NFKC");
  const options = q.options.map((o) => parseDecimal(o.text));
  const issues: string[] = [];

  const sum = /^\s*(\d+(?:\.\d+)?)\s*([+\-−–])\s*(\d+(?:\.\d+)?)\s*=\s*\?\s*$/.exec(stem);
  if (sum) {
    const a = parseDecimal(sum[1]!);
    const b = parseDecimal(sum[3]!);
    if (a === undefined || b === undefined) return na;
    const truth = sum[2] === "+" ? a + b : a - b;
    if (truth < 0) return na;
    if (options.some((o) => o === undefined)) return na;
    options.forEach((o, i) => {
      if (i === q.correctIndex && o !== truth) issues.push(`The marked answer ${q.options[i]!.text} is not ${(truth / SCALE).toString()}.`);
      if (i !== q.correctIndex && o === truth) issues.push(`Option ${q.options[i]!.text} is also correct.`);
    });
    return { status: issues.length ? "failed" : "verified", issues };
  }

  const cmp = /^\s*Which is (greater|smaller|larger|bigger|less)\s*:\s*(\d+(?:\.\d+)?)\s+or\s+(\d+(?:\.\d+)?)\s*\?\s*$/i.exec(stem);
  if (cmp) {
    const a = parseDecimal(cmp[2]!);
    const b = parseDecimal(cmp[3]!);
    if (a === undefined || b === undefined || a === b) return na;
    const wantBigger = /greater|larger|bigger/i.test(cmp[1]!);
    const truth = wantBigger ? Math.max(a, b) : Math.min(a, b);
    const correct = options[q.correctIndex];
    if (correct !== truth) issues.push(`The marked answer ${q.options[q.correctIndex]?.text} is not the ${wantBigger ? "greater" : "smaller"} number.`);
    options.forEach((o, i) => {
      if (i !== q.correctIndex && o === truth) issues.push(`Option ${q.options[i]!.text} is also correct.`);
    });
    return { status: issues.length ? "failed" : "verified", issues };
  }
  return na;
}
