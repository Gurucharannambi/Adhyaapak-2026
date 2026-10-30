import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { AssignResponse, GroupKey, LessonResponse, RunSummary } from "@adhyaapak/shared";
import { Banner } from "../../../components/ui";
import { ApiRequestError, api } from "../../../services/api";

const LANES: GroupKey[] = ["foundation", "guided", "challenge", "follow_up"];
const LEVEL: Partial<Record<GroupKey, "foundation" | "guided" | "challenge">> = { foundation: "foundation", guided: "guided", challenge: "challenge" };
type Student = RunSummary["groups"][number]["students"][number];
type Move = { to: GroupKey; reason: string };
const pupils = (n: number) => `${n} ${n === 1 ? "student" : "students"}`;

/**
 * The branch after a check: Foundation, Guided practice, Challenge and Needs more evidence, each with the lesson's own
 * material for that path and the students the rules suggest, with their reasons. The teacher can move anyone (and must say
 * why), then assign. The server recomputes every suggestion, so nothing typed here can invent a reason or evidence.
 */
export function NextStepsPanel({ classId, lesson, groups, onAssigned }: { classId: string; lesson: LessonResponse; groups: RunSummary["groups"]; onAssigned: () => void }) {
  const { t } = useTranslation();
  const [moves, setMoves] = useState<Record<string, Move>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AssignResponse>();

  const suggested = new Map<string, { lane: GroupKey; student: Student }>();
  for (const g of groups) for (const s of g.students) suggested.set(s.studentId, { lane: g.key, student: s });
  const laneOf = (id: string) => moves[id]?.to ?? suggested.get(id)!.lane;
  const pending = [...suggested.values()].filter((x) => !x.student.assigned);
  const missingReason = Object.entries(moves).filter(([id, m]) => m.to !== suggested.get(id)?.lane && m.reason.trim().length < 3);

  const material = (lane: GroupKey) => {
    const level = LEVEL[lane];
    if (!level) return null;
    return lesson.concept.resources.find((r) => r.level === level && r.type === "explanation" && r.reviewStatus === "approved") ?? null;
  };

  function move(id: string, to: GroupKey) {
    setResult(undefined);
    setMoves((m) => {
      const next = { ...m };
      if (to === suggested.get(id)!.lane) delete next[id];
      else next[id] = { to, reason: m[id]?.reason ?? "" };
      return next;
    });
  }

  async function assign() {
    if (missingReason.length > 0) {
      setError(`Please say why you moved: ${missingReason.map(([id]) => suggested.get(id)!.student.name).join(", ")}.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const assignments = pending.map(({ student }) => {
        const m = moves[student.studentId];
        return { studentId: student.studentId, groupKey: laneOf(student.studentId), ...(m ? { movedReason: m.reason.trim() } : {}) };
      });
      const res = await api<AssignResponse>(`/classes/${classId}/interventions`, { method: "POST", body: { conceptId: lesson.concept.id, assignments } });
      setResult(res);
      setMoves({});
      onAssigned();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  if (suggested.size === 0) return null;

  return (
    <section aria-labelledby="next-h">
      <h2 id="next-h">{t("run.wrap.nextSteps", { defaultValue: "Next steps: one class, several paths" })}</h2>
      <p className="muted">{t("board.intro")}</p>
      <div className="branches">
        {LANES.map((lane) => {
          const here = [...suggested.values()].filter((x) => laneOf(x.student.studentId) === lane);
          const res = material(lane);
          const prereqs = [...new Set(here.flatMap((x) => x.student.prerequisiteTitles))];
          return (
            <article key={lane} className={lane === "follow_up" ? "branch evidence" : "branch"} aria-labelledby={`br-${lane}`}>
              <h3 id={`br-${lane}`}>
                {t(`board.lane.${lane}`)} <span className="hint">({here.length})</span>
              </h3>
              <p className="branch-material">
                {lane === "follow_up" ? (
                  t("run.wrap.followUpMaterial", { defaultValue: "Ask two or three more questions before deciding anything. Not a struggling group." })
                ) : res ? (
                  <>
                    {t("run.wrap.material", { defaultValue: "Material:" })} <strong>{res.title}</strong>{" "}
                    <Link to={`/present/${lesson.concept.id}?level=${LEVEL[lane]}`}>{t("run.wrap.preview", { defaultValue: "preview" })}</Link>
                  </>
                ) : (
                  t("run.wrap.noMaterial", { defaultValue: "No approved material at this level yet." })
                )}
              </p>
              {lane === "foundation" && prereqs.length > 0 && <p className="hint">{t("run.wrap.revise", { defaultValue: "Revise first: {{titles}}", titles: prereqs.join(", ") })}</p>}
              {here.length === 0 ? (
                <p className="hint">{t("run.wrap.nobody", { defaultValue: "Nobody on this path." })}</p>
              ) : (
                <ul className="plain branch-students">
                  {here.map(({ student }) => {
                    const m = moves[student.studentId];
                    const from = suggested.get(student.studentId)!.lane;
                    return (
                      <li key={student.studentId}>
                        <div className="row between">
                          <span>
                            {student.rosterNumber}. {student.name} {student.assigned && <span className="chip ok">{t("run.wrap.assigned", { defaultValue: "Assigned" })}</span>}
                          </span>
                          {!student.assigned && (
                            <label>
                              <span className="sr-only">{t("run.wrap.moveLabel", { defaultValue: "Path for {{name}}", name: student.name })}</span>
                              <select value={laneOf(student.studentId)} onChange={(e) => move(student.studentId, e.target.value as GroupKey)}>
                                {LANES.map((l) => (
                                  <option key={l} value={l}>
                                    {t(`board.lane.${l}`)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                        <p className="hint" style={{ margin: 0 }}>
                          {m ? t("run.wrap.movedFrom", { defaultValue: "Moved from {{lane}}. Suggested because: {{reason}}", lane: t(`board.lane.${from}`), reason: student.reason }) : student.reason}
                        </p>
                        {m && (
                          <label className="field" style={{ marginTop: "var(--s1)" }}>
                            <span>{t("run.wrap.whyMove", { defaultValue: "Why move {{name}}?", name: student.name })}</span>
                            <input value={m.reason} maxLength={300} onChange={(e) => setMoves((all) => ({ ...all, [student.studentId]: { ...m, reason: e.target.value } }))} />
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          );
        })}
      </div>
      {error && (
        <Banner tone="err">
          <p>{error}</p>
        </Banner>
      )}
      {result && (
        <Banner tone="ok">
          <p>
            {t("run.wrap.assignedCount", { defaultValue: "Next activity assigned to {{who}}.", who: pupils(result.assigned.length) })}
            {result.skipped.length > 0 && ` ${result.skipped.map((s) => s.message).join(" ")}`}
          </p>
          <p>
            <Link to={`/classes/${classId}/branch-board?concept=${lesson.concept.id}`}>{t("run.wrap.toBoard", { defaultValue: "Follow-up checks and progress are on the Branch Board" })}</Link>
          </p>
        </Banner>
      )}
      {pending.length > 0 && (
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void assign()}>
            {busy ? t("common.saving") : t("run.wrap.assignPaths", { defaultValue: "Assign these next steps ({{who}})", who: pupils(pending.length) })}
          </button>
        </div>
      )}
    </section>
  );
}
