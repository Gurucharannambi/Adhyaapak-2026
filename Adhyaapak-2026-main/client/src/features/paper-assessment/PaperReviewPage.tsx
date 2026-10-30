import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import type { PaperItemDto, PaperReading, PaperSubmissionDto } from "@adhyaapak/shared";
import { useAppConfig } from "../../app/ConfigContext";
import { AsyncView } from "../../components/AsyncView";
import { Banner, Icon, PageHead } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";
import { choose, initialDraft, readingKey, toRequest, unsettled, type DraftItem } from "./review-state";

/**
 * Side by side: the photo on one side, the answers on the other. The reader's output is only a
 * starting point. Nothing becomes part of the learning record until the teacher approves it here.
 */
export function PaperReviewPage() {
  const { sheetId } = useParams();
  const state = useApi<PaperSubmissionDto>(`/submission-files/${sheetId}`);
  return <AsyncView state={state}>{(s) => <Review key={`${s.id}:${s.extraction?.createdAt ?? "none"}`} sheet={s} reload={state.reload} />}</AsyncView>;
}

const LETTERS = "ABCDEFGH";

function Review({ sheet, reload }: { sheet: PaperSubmissionDto; reload: () => void }) {
  const { t } = useTranslation();
  const { aiEnabled } = useAppConfig();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<DraftItem[]>(() => initialDraft(sheet.items));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [approved, setApproved] = useState(false);

  const finished = sheet.status === "approved" || sheet.status === "rejected";
  const open = unsettled(sheet.items, draft);
  const canApprove = !finished && sheet.imageAvailable && open.length === 0;
  const imageUrl = `/api/v1/submission-files/${sheet.id}/image`;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  const readWithAi = () => run(async () => {
    await api(`/submission-files/${sheet.id}/process`, { method: "POST", body: { confirmSendToAi: true } });
    reload(); // a fresh reading replaces the working answers, so the form is rebuilt from the server
  });

  const save = async () => {
    const body = toRequest(draft);
    if (!body) throw new ApiRequestError("validation_error", t("paper.chooseAll"), 400);
    await api(`/submission-files/${sheet.id}/review`, { method: "POST", body });
  };

  const saveOnly = () => run(async () => {
    await save();
    setNotice(t("paper.saved"));
    reload();
  });

  const approve = () => run(async () => {
    await save();
    await api(`/submission-files/${sheet.id}/approve`, { method: "POST", body: {} });
    setApproved(true);
    reload();
  });

  const reject = () => run(async () => {
    await api(`/submission-files/${sheet.id}/reject`, { method: "POST", body: {} });
    navigate(`/activities/${sheet.assessmentId}/paper`);
  });

  const deletePhoto = () => run(async () => {
    await api(`/submission-files/${sheet.id}/image`, { method: "DELETE" });
    reload();
  });

  return (
    <>
      <PageHead
        title={t("paper.reviewTitle", { name: sheet.studentName })}
        back={
          <Link className="back" to={`/activities/${sheet.assessmentId}/paper`}>
            <Icon name="back" /> <span>{t("paper.title")}</span>
          </Link>
        }
      />
      <p>
        <span className="chip">{t(`paper.status.${sheet.status}`)}</span>
        {sheet.rosterNumber !== null && <> · {t("paper.rollNo", { n: sheet.rosterNumber })}</>}
      </p>

      {approved || sheet.status === "approved" ? (
        <Banner tone="ok">
          <p>
            {t("paper.approvedMsg")} <Link to={`/activities/${sheet.assessmentId}`}>{t("paper.backToActivity")}</Link>
          </p>
        </Banner>
      ) : null}
      {sheet.status === "rejected" && <Banner tone="info"><p>{t("paper.rejectedMsg")}</p></Banner>}

      <div className="compare">
        <section aria-labelledby="photo-h">
          <h2 id="photo-h" style={{ marginTop: 0 }}>{t("paper.photoHeading")}</h2>
          {sheet.imageAvailable ? (
            <>
              <img src={imageUrl} alt={t("paper.photoAlt", { name: sheet.studentName })} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain", border: "2px solid var(--ink)", background: "#d9dde6" }} />
              <p>
                <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                  {t("paper.openFull")}
                </a>
              </p>
            </>
          ) : (
            <div className="state-empty" role="status"><p>{t("paper.photoGone")}</p></div>
          )}
          {sheet.metadataStripped && <p className="pen">{t("paper.stripped")}</p>}
          {sheet.deleteAfter && sheet.imageAvailable && (
            <p className="hint">{t("paper.deleteAfter", { date: new Date(sheet.deleteAfter).toLocaleDateString() })}</p>
          )}
        </section>

        <section aria-labelledby="ans-h">
          <h2 id="ans-h" style={{ marginTop: 0 }}>{t("paper.answersHeading")}</h2>

          {!finished && !sheet.extraction && (
            <div className="panel" style={{ marginTop: 0 }}>
              <p>{t("paper.readIntro")}</p>
              {aiEnabled ? (
                <>
                  <div className="choice">
                    <input id="ai-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    <label htmlFor="ai-consent">{t("paper.consent")}</label>
                  </div>
                  <p>
                    <button className="btn btn-primary" disabled={busy || !consent || !sheet.imageAvailable} onClick={() => void readWithAi()}>
                      {busy ? t("paper.readingNow") : t("paper.readWithAi")}
                    </button>
                  </p>
                </>
              ) : (
                <p className="pen">{t("paper.aiOff")}</p>
              )}
            </div>
          )}
          {sheet.extraction?.status === "failed" && <Banner tone="warn"><p>{t("paper.readFailed")}</p></Banner>}
          {sheet.extraction && (
            <p className="hint">{t("paper.readBy", { who: sheet.extraction.extractor, version: sheet.extraction.processingVersion })}</p>
          )}

          {sheet.items.map((item) => (
            <QuestionRow key={item.questionId} item={item} draft={draft.find((d) => d.questionId === item.questionId)!} disabled={finished || busy} onChoose={(r) => setDraft((d) => choose(d, item.questionId, r))} />
          ))}

          {!finished && (
            <>
              {open.length > 0 && (
                <p className="decide-box" role="status">{t("paper.remaining", { count: open.length })}</p>
              )}
              <div className="btn-row">
                <button className="btn btn-primary" disabled={busy || !canApprove} onClick={() => void approve()}>
                  {t("paper.approve")}
                </button>
                <button className="btn" disabled={busy || !sheet.imageAvailable || toRequest(draft) === null} onClick={() => void saveOnly()}>
                  {t("paper.saveLater")}
                </button>
                <button className="btn btn-danger" disabled={busy} onClick={() => void reject()}>
                  {t("paper.reject")}
                </button>
              </div>
              <p className="pen">{t("paper.approveHelp")}</p>
            </>
          )}
          {sheet.imageAvailable && (
            <p>
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void deletePhoto()}>
                {t("paper.deletePhoto")}
              </button>
            </p>
          )}
          {notice && <Banner tone="ok"><p>{notice}</p></Banner>}
          {error && <Banner tone="err"><p>{error}</p></Banner>}
        </section>
      </div>
    </>
  );
}

function QuestionRow({ item, draft, disabled, onChoose }: { item: PaperItemDto; draft: DraftItem; disabled: boolean; onChoose: (r: PaperReading) => void }) {
  const { t } = useTranslation();
  const name = `q-${item.questionId}`;
  const label = (r: PaperReading) => (r.kind === "option" ? `${LETTERS[item.options.findIndex((o) => o.id === r.optionId)] ?? "?"}` : t(`paper.reading.${r.kind}`));
  const choices: Array<{ reading: PaperReading; text: string }> = [
    ...item.options.map((o, i) => ({ reading: { kind: "option", optionId: o.id } as PaperReading, text: `${LETTERS[i]}. ${o.text}` })),
    { reading: { kind: "blank" }, text: t("paper.reading.blank") },
    { reading: { kind: "unreadable" }, text: t("paper.reading.unreadable") },
  ];
  const needsLook = item.needsDecision && !draft.confirmed;
  return (
    <fieldset className={needsLook ? "answer-block needs" : "answer-block"}>
      <legend>
        <strong>
          {item.position}. {item.stem}
        </strong>
      </legend>
      <p style={{ margin: "0 0 0.4rem" }}>
        <span className="hint">
          {item.extracted
            ? item.extracted.reading.kind === "unreadable"
              ? t("paper.readerCouldNot")
              : t("paper.readerSaw", { answer: label(item.extracted.reading), how: t(`paper.legibility.${item.extracted.legibility}`) })
            : t("paper.notRead")}
          {item.extracted?.note ? ` — ${item.extracted.note}` : ""}
        </span>
        {needsLook && (
          <>
            {" "}
            <span className="chip decide">{t("paper.checkPhoto")}</span>
          </>
        )}
      </p>
      <div className="row" style={{ gap: "0 var(--s5)" }}>
        {choices.map((c) => (
          <label key={readingKey(c.reading)} className="choice" style={{ cursor: "pointer" }}>
            <input type="radio" name={name} disabled={disabled} checked={draft.choice !== null && readingKey(draft.choice) === readingKey(c.reading)} onChange={() => onChoose(c.reading)} /> {c.text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
