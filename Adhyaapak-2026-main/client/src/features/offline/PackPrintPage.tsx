import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { OfflinePackDto } from "@adhyaapak/shared";
import { Icon, PageHead } from "../../components/ui";
import { getLocalPack } from "./packs";

const LETTERS = "ABCDEFGH";

/**
 * Everything a teacher prints for the lesson, from the pack on this device: the student worksheet, the
 * teacher's answer key (printed on its own page, never shown on screen to students), and a response sheet
 * to write answers on if no device is available. Works with no connection.
 */
export function PackPrintPage() {
  const { t } = useTranslation();
  const { packId } = useParams();
  const [pack, setPack] = useState<OfflinePackDto | null>();
  useEffect(() => {
    getLocalPack(packId!).then((p) => setPack(p ?? null)).catch(() => setPack(null));
  }, [packId]);

  if (pack === undefined) return <p role="status">{t("common.loading")}</p>;
  if (pack === null)
    return (
      <p role="alert" className="state-error">
        {t("offline.packMissing")} <Link to="/offline">{t("offline.title")}</Link>
      </p>
    );

  const keyBy = new Map(pack.answerKey.map((k) => [k.questionId, k]));
  return (
    <>
      <div className="no-print">
        <PageHead
          title={t("offline.printTitle")}
          lede={t("offline.printIntro")}
          back={
            <Link className="back" to={`/offline/packs/${pack.id}`}>
              <Icon name="back" /> <span>{pack.conceptTitle}</span>
            </Link>
          }
        />
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => window.print()}>
            <Icon name="print" /> {t("paper.print")}
          </button>
        </div>
      </div>

      <section className="print-sheet" style={{ border: "1px solid var(--rule)", padding: "var(--s5)", marginBottom: "var(--s5)", background: "#fff" }}>
        <h2 style={{ marginTop: 0 }}>
          {t("offline.worksheet")}: {pack.conceptTitle}
        </h2>
        <p>{t("offline.nameLine")}</p>
        {pack.questions.map((q, i) => (
          <div key={q.id} className="qrow" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <strong>{i + 1}.</strong> {q.stem}
            <div className="qopts">
              {q.options.map((o, k) => (
                <span key={o.id}>
                  {LETTERS[k]}) {o.text}
                </span>
              ))}
            </div>
          </div>
          </div>
        ))}
      </section>

      <section className="print-sheet" style={{ border: "1px solid var(--rule)", padding: "var(--s5)", marginBottom: "var(--s5)", background: "#fff" }}>
        <h2 style={{ marginTop: 0 }}>
          {t("offline.responseSheet")}: {pack.conceptTitle}
        </h2>
        <p>{t("offline.responseHelp")}</p>
        <table className="ruled" style={{ border: "2px solid #000" }}>
          <thead>
            <tr>
              <th>{t("offline.roll")}</th>
              {pack.questions.map((q, i) => (
                <th key={q.id}>Q{i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pack.rollNumbers.map((r) => (
              <tr key={r}>
                <th scope="row" className="num">{r}</th>
                {pack.questions.map((q) => (
                  <td key={q.id} style={{ height: "2.2cm", border: "3px solid #000" }} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p>{t("offline.syncLater")}</p>
      </section>

      <section className="print-sheet" style={{ border: "1px solid var(--rule)", padding: "var(--s5)", marginBottom: "var(--s5)", background: "#fff" }}>
        <h2 style={{ marginTop: 0 }}>
          {t("offline.teacherKey")}: {pack.conceptTitle}
        </h2>
        <p>
          <strong>{t("offline.keyWarning")}</strong>
        </p>
        <ol>
          {pack.questions.map((q) => {
            const k = keyBy.get(q.id);
            const idx = q.options.findIndex((o) => o.id === k?.correctOptionId);
            return (
              <li key={q.id}>
                {q.stem} — <strong>{LETTERS[idx]}</strong> ({q.options[idx]?.text}){k?.explanation ? <small> {k.explanation}</small> : null}
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

