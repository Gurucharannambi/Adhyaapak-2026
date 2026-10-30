import { useState } from "react";
import { Link } from "react-router";
import type { GrowthGroup, GrowthKey } from "@adhyaapak/shared";
import { Icon } from "../../components/ui";
import { initials } from "../../utils/initials";

export const GROWTH_LABEL: Record<GrowthKey, { title: string; criterion: string; tone: string }> = {
  ready_for_challenge: { title: "Ready for a challenge", criterion: "Mastery status 'ready for a challenge': secure, including right answers to harder questions.", tone: "" },
  recently_secure: { title: "Recently secure", criterion: "Mastery status 'likely secure', with answers in the last 14 days.", tone: "" },
  improved: { title: "Improved", criterion: "At least 4 counted answers on one concept: a mistake among the first two, and the latest two right. Measured against the student's own start.", tone: "sun" },
  practice: { title: "Consistent practice", criterion: "At least 3 practice sets finished in the last 14 days. Only shown when practice is recorded.", tone: "sky" },
  needs_explanation: { title: "Could use another explanation", criterion: "Mastery status 'needs foundation' from at least 2 counted answers. About the idea, not the child.", tone: "sky" },
};

/**
 * Evidence-based recognition, two cards at a time. Each card says which rule put the student there and the evidence
 * behind it. It is private to the teacher and is not a ranking.
 */
export function GrowthCards({ groups, classId, emptyAction }: { groups: GrowthGroup[]; classId: string; emptyAction?: React.ReactNode }) {
  const entries = groups.flatMap((g) => g.students.map((s) => ({ ...s, key: g.key })));
  const pages = Math.max(1, Math.ceil(entries.length / 2));
  const [page, setPage] = useState(0);
  const shown = entries.slice(page * 2, page * 2 + 2);
  return (
    <>
      <div className="g-head">
        <h2 id="growth-h">Student growth</h2>
        {entries.length > 2 && (
          <span className="pager">
            <button type="button" aria-label="Previous students" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <Icon name="arrowL" />
            </button>
            <span aria-live="polite">
              {page + 1} / {pages}
            </span>
            <button type="button" aria-label="Next students" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              <Icon name="arrowR" />
            </button>
          </span>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="glass-in">
          <p style={{ marginTop: 0 }}>Nothing to recognise yet. Growth appears here once students have recorded answers, and only from those answers.</p>
          {emptyAction}
        </div>
      ) : (
        <ul className="rec-cards plain">
          {shown.map((e) => {
            const label = GROWTH_LABEL[e.key];
            return (
              <li key={`${e.key}-${e.studentId}`} className="rec-card">
                <div className="top">
                  <div>
                    <h3>{e.name}</h3>
                    <span className="role">Student</span>
                  </div>
                  <Link className="mini-link" to={`/classes/${classId}/students/${e.studentId}`}>
                    View details
                  </Link>
                </div>
                <div className="face">
                  <span className={`av lg ${label.tone}`} aria-hidden="true">
                    {initials(e.name)}
                  </span>
                </div>
                <p className="why">{e.why}</p>
                <div className="foot">
                  <span className="chip ok">{label.title}</span>
                  {e.conceptTitle && (
                    <span>
                      Concept: <b>{e.conceptTitle}</b>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
