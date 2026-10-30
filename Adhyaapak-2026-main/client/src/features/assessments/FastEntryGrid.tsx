import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssessmentDetailDto, GridEntryResponse } from "@adhyaapak/shared";
import { ApiRequestError, api } from "../../services/api";

type Confidence = "sure" | "unsure" | "guess";
const CONF: Record<string, Confidence> = { s: "sure", u: "unsure", g: "guess" };

export interface ParsedCell {
  answer: { kind: "option"; optionId: string } | { kind: "blank" } | { kind: "unreadable" };
  confidence?: Confidence;
}

/**
 * One grid cell: "b" = option B, "bs" = option B and the student was sure (s/u/g),
 * "?" = unreadable on the paper, empty or "-" = left blank. Returns an error message key for anything else.
 */
export function parseCell(raw: string, validOptionIds: readonly string[]): ParsedCell | { error: string } {
  const v = raw.trim().toLowerCase();
  if (v === "" || v === "-") return { answer: { kind: "blank" } };
  if (v === "?") return { answer: { kind: "unreadable" } };
  const m = /^([a-z0-9])([sug])?$/.exec(v);
  if (!m || !validOptionIds.includes(m[1]!)) return { error: "grid.badCell" };
  return { answer: { kind: "option", optionId: m[1]! }, ...(m[2] ? { confidence: CONF[m[2]]! } : {}) };
}

/** Roster × question keyboard grid for answers from paper or hand-raising (standout feature, never needs a device). */
export function FastEntryGrid({ detail, onSaved }: { detail: AssessmentDetailDto; onSaved: () => void }) {
  const { t } = useTranslation();
  const pending = detail.students.filter((s) => !s.submitted);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GridEntryResponse>();
  const [error, setError] = useState<string>();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const key = (s: string, q: string) => `${s}:${q}`;

  const parsed = pending.map((s) => ({
    student: s,
    cells: detail.questions.map((q) => ({ q, value: cells[key(s.id, q.id)] ?? "", parsed: parseCell(cells[key(s.id, q.id)] ?? "", q.options.map((o) => o.id)) })),
  }));
  const touched = (row: (typeof parsed)[number]) => row.cells.some((c) => c.value.trim() !== "");
  const hasError = parsed.some((r) => r.cells.some((c) => "error" in c.parsed));
  const readyRows = parsed.filter(touched);

  function onKey(e: React.KeyboardEvent<HTMLInputElement>, si: number, qi: number) {
    const move = (ds: number, dq: number) => {
      const s = pending[si + ds];
      const q = detail.questions[qi + dq];
      if (s && q) {
        e.preventDefault();
        inputs.current[key(s.id, q.id)]?.focus();
        inputs.current[key(s.id, q.id)]?.select();
      }
    };
    if (e.key === "Enter" || e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) move(0, 1);
    else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) move(0, -1);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const entries = readyRows.map((r) => ({
        studentId: r.student.id,
        answers: r.cells.map((c) => ({ questionId: c.q.id, answer: (c.parsed as ParsedCell).answer, ...((c.parsed as ParsedCell).confidence ? { confidence: (c.parsed as ParsedCell).confidence } : {}) })),
      }));
      const res = await api<GridEntryResponse>(`/assessments/${detail.id}/entry`, { method: "POST", body: { entries } });
      setResult(res);
      setCells((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !res.saved.some((id) => k.startsWith(`${id}:`)))));
      onSaved();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  if (pending.length === 0) return <div className="state-empty"><p>{t("grid.allDone")}</p></div>;

  return (
    <section aria-labelledby="grid-h">
      <h2 id="grid-h">{t("grid.title")}</h2>
      <p>{t("grid.help")}</p>
      <div className="table-wrap"><table className="ruled entry">
        <thead>
          <tr>
            <th scope="col">{t("classPage.rosterNumber")}</th>
            <th scope="col">{t("classPage.name")}</th>
            {detail.questions.map((q, i) => (
              <th key={q.id} scope="col" title={q.stem}>
                Q{i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parsed.map((row, si) => (
            <tr key={row.student.id}>
              <td className="num">{row.student.rosterNumber}</td>
              <td>{row.student.name}</td>
              {row.cells.map((c, qi) => {
                const bad = "error" in c.parsed;
                return (
                  <td key={c.q.id}>
                    <input className="input"
                      ref={(el) => {
                        inputs.current[key(row.student.id, c.q.id)] = el;
                      }}
                      aria-label={t("grid.cellLabel", { student: row.student.name, n: qi + 1 })}
                      aria-invalid={bad}
                      value={c.value}
                      onChange={(e) => setCells((x) => ({ ...x, [key(row.student.id, c.q.id)]: e.target.value }))}
                      onKeyDown={(e) => onKey(e, si, qi)}
                      size={3}
                      maxLength={3}
                      style={{ width: "3.2rem", textAlign: "center", fontFamily: "monospace", ...(bad ? { outline: "2px solid #b00020" } : {}) }}
                    />
                    {bad && <span role="alert"> ✗</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table></div>
      {hasError && <p role="alert" className="state-error">{t("grid.fixErrors")}</p>}
      <p>
        <button className="btn btn-primary" disabled={busy || hasError || readyRows.length === 0} onClick={() => void save()}>
          {t("grid.save", { count: readyRows.length })}
        </button>
      </p>
      {error && <p role="alert" className="state-error">{error}</p>}
      {result && (
        <div aria-live="polite">
          <p>{t("grid.saved", { count: result.saved.length })}</p>
          {result.alreadySubmitted.length > 0 && <p>{t("grid.already", { count: result.alreadySubmitted.length })}</p>}
          {result.failed.map((f) => (
            <p key={f.studentId} role="alert">
              ✗ {detail.students.find((s) => s.id === f.studentId)?.name ?? f.studentId}: {f.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
