import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { BriefItem, BriefListResponse, BriefSection, TeachingBriefDto } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { Banner, Icon } from "../../components/ui";
import { ApiRequestError, api } from "../../services/api";

const ORDER: BriefSection[] = ["carry_over", "secure", "revision", "patterns", "assess", "challenge", "revisit", "activity", "follow_up"];

/**
 * Tomorrow's Teaching Brief. Measured lines (counts from stored records) and suggestions (built on those lines)
 * are shown apart and labelled. The teacher accepts, rewords or dismisses each; nothing is acted on for them.
 */
export function BriefPage() {
  const { t } = useTranslation();
  const { classId } = useParams();
  const list = useApi<BriefListResponse>(`/classes/${classId}/teaching-briefs`);
  const [brief, setBrief] = useState<TeachingBriefDto>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(undefined);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const generate = async () => {
    const b = await run(() => api<TeachingBriefDto>(`/classes/${classId}/teaching-briefs`, { method: "POST", body: {} }));
    if (b) {
      setBrief(b);
      list.reload();
    }
  };
  const open = async (id: string) => {
    const b = await run(() => api<TeachingBriefDto>(`/teaching-briefs/${id}`));
    if (b) setBrief(b);
  };
  const update = async (item: BriefItem, body: { status?: BriefItem["status"]; editedText?: string | null }) => {
    const b = await run(() => api<TeachingBriefDto>(`/teaching-briefs/${brief!.id}/items/${encodeURIComponent(item.id)}`, { method: "PATCH", body }));
    if (b) setBrief(b);
  };

  return (
    <>
      <div className="page-head">
        <Link className="back no-print" to={`/classes/${classId}`}>
          <Icon name="back" /> <span>{t("activity.backToClass")}</span>
        </Link>
        <h1>{t("brief.title")}</h1>
        <p className="lede no-print">{t("brief.intro")}</p>
      </div>
      <div className="btn-row no-print">
        <button className="btn btn-primary" onClick={() => void generate()} disabled={busy}>
          {busy && !brief ? t("brief.generating") : t("brief.generate")}
        </button>
        {brief && <button className="btn" onClick={() => window.print()}>{t("brief.print")}</button>}
      </div>
      {error && <Banner tone="err"><p>{error}</p></Banner>}

      {!brief && (
        <div className="no-print">
          <h2>{t("brief.earlier")}</h2>
          <AsyncView state={list}>
            {(l) =>
              l.briefs.length === 0 ? (
                <div className="state-empty"><p>{t("brief.none")}</p></div>
              ) : (
                <ul className="plain rule-list">
                  {l.briefs.map((b) => (
                    <li key={b.id}>
                      <button className="btn btn-sm" onClick={() => void open(b.id)}>{new Date(b.createdAt).toLocaleString()}</button> · {t("brief.counts", { items: b.items, accepted: b.accepted })}
                    </li>
                  ))}
                </ul>
              )
            }
          </AsyncView>
        </div>
      )}

      {brief && <Brief brief={brief} classId={classId!} busy={busy} update={update} />}
    </>
  );
}

function Brief({ brief, classId, busy, update }: { brief: TeachingBriefDto; classId: string; busy: boolean; update: (i: BriefItem, b: { status?: BriefItem["status"]; editedText?: string | null }) => Promise<void> }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState("");
  return (
    <article>
      <p>
        <strong>
          {brief.className} · {new Date(brief.createdAt).toLocaleDateString()}
        </strong>
        <br />
        <span className="hint">{t("brief.basis", { ...brief.basis, count: brief.basis.conceptsWithEvidence })}</span>
      </p>
      {ORDER.map((section) => {
        const items = brief.items.filter((i) => i.section === section && i.status !== "dismissed");
        if (items.length === 0) return null;
        return (
          <section key={section} aria-labelledby={`b-${section}`}>
            <h2 id={`b-${section}`}>{t(`brief.section.${section}`)}</h2>
            <ul className="plain">
              {items.map((i) => (
                <li key={i.id} className={i.kind === "measured" ? "brief-line" : "brief-line sug"}>
                  <p className="meta" style={{ margin: 0 }}>
                    <span className={i.kind === "measured" ? "chip rec" : "chip sug"}>{i.kind === "measured" ? t("brief.measured") : t("brief.suggestion")}</span>
                    {i.status === "accepted" && ` · ✓ ${t("brief.accepted")}`}
                    {i.status === "done" && ` · ✓✓ ${t("brief.done")}`}
                  </p>
                  {editing === i.id ? (
                    <span className="no-print">
                      <textarea className="input" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} aria-label={t("brief.editLabel")} />
                      <button className="btn btn-primary btn-sm"
                        disabled={busy || !draft.trim()}
                        onClick={() => {
                          void update(i, { editedText: draft.trim() }).then(() => setEditing(undefined));
                        }}
                      >
                        {t("drafts.save")}
                      </button>{" "}
                      <button className="btn btn-sm" onClick={() => setEditing(undefined)}>{t("brief.cancel")}</button>
                    </span>
                  ) : (
                    <span>{i.editedText ?? i.text}</span>
                  )}
                  {i.editedText && <small> ({t("brief.edited")})</small>}
                  {i.rollNumbers.length > 0 && (
                    <>
                      <br />
                      <small>
                        {t("offline.roll")}: {i.rollNumbers.join(", ")}
                      </small>
                    </>
                  )}
                  <br />
                  <small>
                    {t("brief.basedOn")}:{" "}
                    {i.evidence.map((e, k) => (
                      <span key={k}>
                        {k > 0 && "; "}
                        {e.conceptId ? (
                          <Link to={`/classes/${classId}/map`} className="no-print">
                            {e.label}
                          </Link>
                        ) : (
                          e.label
                        )}
                        <span className="print-only">{e.conceptId ? e.label : ""}</span>
                      </span>
                    ))}
                    {i.basedOn.length > 0 && ` · ${t("brief.restsOn", { count: i.basedOn.length })}`}
                  </small>
                  <span className="no-print actions-inline" style={{ marginTop: "0.3rem" }}>
                    {i.status === "proposed" && (
                      <>
                        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void update(i, { status: "accepted" })}>
                          {t("brief.accept")}
                        </button>
                      </>
                    )}
                    {i.kind === "inferred" && i.status === "accepted" && (
                      <>
                        <button className="btn btn-sm" disabled={busy} onClick={() => void update(i, { status: "done" })}>
                          {t("brief.markDone")}
                        </button>
                      </>
                    )}
                    <button className="btn btn-sm"
                      onClick={() => {
                        setEditing(i.id);
                        setDraft(i.editedText ?? i.text);
                      }}
                    >
                      {t("brief.edit")}
                    </button>
                    <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void update(i, { status: "dismissed" })}>
                      {t("brief.dismiss")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p>
        <small>{t("brief.footer")}</small>
      </p>
    </article>
  );
}

