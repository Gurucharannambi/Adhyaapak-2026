import type { MasteryStatus } from "@adhyaapak/shared";

export const STATUS_ORDER: MasteryStatus[] = ["not_enough_evidence", "needs_foundation", "developing", "likely_secure", "ready_for_challenge"];
export const STATUS_LABEL: Record<MasteryStatus, { title: string; sub: string }> = {
  not_enough_evidence: { title: "Not enough", sub: "evidence yet" },
  needs_foundation: { title: "Foundation", sub: "needs revisiting" },
  developing: { title: "Developing", sub: "getting there" },
  likely_secure: { title: "Likely secure", sub: "from answers" },
  ready_for_challenge: { title: "Challenge", sub: "ready for more" },
};

/** A round number above the largest bar, so the scale reads cleanly (0, ¼, ½, ¾, top). */
export function niceMax(n: number): number {
  if (n <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 4, 5, 10]) if (m * step >= n) return m * step;
  return 10 * step;
}

/**
 * Pill bars of student-and-concept pairs by mastery status. Each bar carries its number, and every status is also
 * written out, so nothing depends on colour or bar length alone. "Not enough evidence" is drawn hatched: it is a gap
 * in the evidence, not a result.
 */
export function ProgressChart({ byStatus, caption }: { byStatus: Record<MasteryStatus, number>; caption: string }) {
  const max = niceMax(Math.max(0, ...STATUS_ORDER.map((s) => byStatus[s] ?? 0)));
  const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0].map((v) => (Number.isInteger(v) ? v : v.toFixed(1)));
  return (
    <figure style={{ margin: 0 }}>
      <div className="pchart" role="img" aria-label={`${caption}. ${STATUS_ORDER.map((s) => `${STATUS_LABEL[s].title} ${STATUS_LABEL[s].sub}: ${byStatus[s] ?? 0}`).join("; ")}.`}>
        <div className="yaxis" aria-hidden="true">
          {ticks.map((v, i) => (
            <span key={i}>{v}</span>
          ))}
        </div>
        <div className="plot" aria-hidden="true">
          {STATUS_ORDER.map((s) => {
            const n = byStatus[s] ?? 0;
            const cls = n === 0 ? "bar zero" : s === "not_enough_evidence" ? "bar none" : s === "likely_secure" || s === "ready_for_challenge" ? "bar hi" : "bar";
            return (
              <div key={s} className={cls} style={{ height: n ? `max(${(n / max) * 100}%, 18px)` : 0 }}>
                <b>{n}</b>
              </div>
            );
          })}
        </div>
        <div className="xaxis" aria-hidden="true">
          {STATUS_ORDER.map((s) => (
            <div key={s}>
              <i className={s === "likely_secure" ? "hi" : undefined} />
              <strong>{STATUS_LABEL[s].title}</strong>
              <span>{STATUS_LABEL[s].sub}</span>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="g-note" style={{ marginTop: 12 }}>
        {caption}
      </figcaption>
    </figure>
  );
}
