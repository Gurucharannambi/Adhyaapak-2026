import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { OfflinePackDto, SyncOperation } from "@adhyaapak/shared";
import { getLocalPack, preflight, type PreflightCheck } from "./packs";
import { enqueue, newOperationKey } from "./queue";
import { Banner, Icon } from "../../components/ui";
import { useSync } from "./SyncContext";

const LETTERS = "ABCDEFGH";
const recordedKey = (packId: string) => `adhyaapak.recorded.${packId}`;

/** Roll numbers already recorded from this pack on this device. Numbers only, so nothing identifies a child. */
function loadRecorded(packId: string): number[] {
  try {
    return JSON.parse(localStorage.getItem(recordedKey(packId)) ?? "[]") as number[];
  } catch {
    return [];
  }
}
function saveRecorded(packId: string, rolls: number[]) {
  try {
    localStorage.setItem(recordedKey(packId), JSON.stringify(rolls));
  } catch {
    // Without it the page simply cannot grey out finished rows; the server still refuses duplicates.
  }
}

/** One lesson pack, read entirely from this device: teach it, print it, and record the class's answers. */
export function OfflinePackPage() {
  const { t } = useTranslation();
  const { packId } = useParams();
  const sync = useSync();
  const [pack, setPack] = useState<OfflinePackDto | null>();
  const [recorded, setRecorded] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<number, Record<string, string>>>({});
  const [checks, setChecks] = useState<PreflightCheck[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    getLocalPack(packId!)
      .then((p) => {
        if (cancelled) return;
        setPack(p ?? null);
        setRecorded(loadRecorded(packId!));
      })
      .catch(() => !cancelled && setPack(null));
    return () => {
      cancelled = true;
    };
  }, [packId]);

  const record = useCallback(
    async (p: OfflinePackDto, roll: number) => {
      setError(undefined);
      const mine = answers[roll] ?? {};
      const op: SyncOperation = {
        idempotencyKey: newOperationKey(),
        type: "record_responses",
        baseVersion: p.version,
        recordedAt: new Date().toISOString(),
        payload: {
          assessmentId: p.assessmentId,
          rosterNumber: roll,
          // A question left empty is recorded as blank (no evidence), never as wrong.
          responses: p.questions.map((q) => {
            const v = mine[q.id] ?? "";
            return { questionId: q.id, answer: v === "" || v === "blank" ? { kind: "blank" as const } : v === "unreadable" ? { kind: "unreadable" as const } : { kind: "option" as const, optionId: v } };
          }),
        },
      };
      try {
        await enqueue(op);
        const next = [...new Set([...recorded, roll])];
        saveRecorded(p.id, next);
        setRecorded(next);
        await sync.refresh();
        if (sync.online) void sync.syncNow();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.unexpectedError"));
      }
    },
    [answers, recorded, sync, t],
  );

  if (pack === undefined) return <p className="state-loading" role="status">{t("common.loading")}</p>;
  if (pack === null)
    return (
      <>
        <Banner tone="err"><p>{t("offline.packMissing")}</p></Banner>
        <Link className="btn" to="/offline">{t("offline.title")}</Link>
      </>
    );

  return (
    <>
      <Link className="back" to="/offline">
        <Icon name="back" /> <span>{t("offline.title")}</span>
      </Link>
      <h1>{pack.conceptTitle}</h1>
      <p>
        {pack.className} · <span className={sync.online ? "chip ok" : "chip check"}>{sync.online ? t("offline.online") : t("offline.offlineNow")}</span>
      </p>
      <ul className="plain">
        {pack.offlineNotes.map((n) => (
          <li key={n} className="pen">
            {n}
          </li>
        ))}
      </ul>

      <h2>{t("offline.teach")}</h2>
      <div className="btn-row">
        <Link className="btn btn-primary" to={`/offline/packs/${pack.id}/present`}>{t("offline.present")}</Link>
        <Link className="btn" to={`/offline/packs/${pack.id}/print`}>{t("offline.printPack")}</Link>
        <button className="btn" onClick={() => void preflight(pack).then(setChecks)}>{t("offline.check")}</button>
      </div>
      {checks && (
        <ul className="plain">
          {checks.map((c) => (
            <li key={c.id}>
              {c.ok ? "✓" : "✗"} {c.detail}
            </li>
          ))}
        </ul>
      )}

      <h2>{t("offline.recordHeading")}</h2>
      <p>{t("offline.recordHelp")}</p>
      <div>
        <div className="table-wrap"><table className="ruled entry">
          <thead>
            <tr>
              <th scope="col">{t("offline.roll")}</th>
              {pack.questions.map((q, i) => (
                <th scope="col" key={q.id} title={q.stem}>
                  Q{i + 1}
                </th>
              ))}
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {pack.rollNumbers.map((roll) => {
              const done = recorded.includes(roll);
              return (
                <tr key={roll}>
                  <th scope="row" className="num">{roll}</th>
                  {pack.questions.map((q, i) => (
                    <td key={q.id}>
                      <select
                        aria-label={t("offline.cellLabel", { roll, q: i + 1 })}
                        disabled={done}
                        value={answers[roll]?.[q.id] ?? ""}
                        onChange={(e) => setAnswers((a) => ({ ...a, [roll]: { ...a[roll], [q.id]: e.target.value } }))}
                      >
                        <option value="">—</option>
                        {q.options.map((o, k) => (
                          <option key={o.id} value={o.id}>
                            {LETTERS[k]}
                          </option>
                        ))}
                        <option value="blank">{t("paper.reading.blank")}</option>
                        <option value="unreadable">{t("paper.reading.unreadable")}</option>
                      </select>
                    </td>
                  ))}
                  <td>
                    {done ? (
                      <span className="chip ok">✓ {t("offline.recorded")}</span>
                    ) : (
                      <button className="btn btn-sm btn-primary" onClick={() => void record(pack, roll)} disabled={!pack.questions.some((q) => (answers[roll]?.[q.id] ?? "") !== "")}>
                        {t("offline.record")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
      {error && <Banner tone="err"><p>{error}</p></Banner>}
      <p className="hint">{t("offline.recordNote")}</p>
    </>
  );
}
