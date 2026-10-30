import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConflictListResponse, SyncStatusResponse } from "@adhyaapak/shared";
import { ApiRequestError, api } from "../../services/api";
import { dismissRejected, listQueue, type QueuedOperation } from "./queue";
import { Banner, PageHead } from "../../components/ui";
import { useSync } from "./SyncContext";

/**
 * What is waiting on this device, what the server refused, and the conflicts only the teacher can settle.
 * Nothing here is ever merged automatically: a conflict stays until the teacher applies or discards it.
 */
export function SyncPage() {
  const { t } = useTranslation();
  const sync = useSync();
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const [conflicts, setConflicts] = useState<ConflictListResponse["conflicts"]>();
  const [status, setStatus] = useState<SyncStatusResponse>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setQueue(await listQueue());
    } catch {
      setQueue([]);
    }
    try {
      const [c, s] = await Promise.all([api<ConflictListResponse>("/sync/conflicts"), api<SyncStatusResponse>("/sync/status")]);
      setConflicts(c.conflicts);
      setStatus(s);
      setError(undefined);
    } catch (e) {
      setConflicts(undefined);
      setError(e instanceof ApiRequestError && (e.code === "network_error" || e.code === "offline") ? t("sync.cannotReach") : e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    }
  }, [t]);
  useEffect(() => void load(), [load, sync.pending, sync.rejected]);

  async function resolve(id: string, action: "apply" | "discard") {
    try {
      await api(`/sync/conflicts/${id}/resolve`, { method: "POST", body: { action } });
      await load();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    }
  }

  const pending = queue.filter((q) => q.state === "pending");
  const rejected = queue.filter((q) => q.state === "rejected");
  return (
    <>
      <PageHead title={t("sync.title")} lede={sync.online ? t("offline.online") : t("offline.offlineNow")} />

      <section aria-labelledby="dev-h">
        <h2 id="dev-h">{t("sync.onDevice", { count: pending.length })}</h2>
        {pending.length === 0 ? (
          <div className="state-empty"><p>{t("sync.nothingWaiting")}</p></div>
        ) : (
          <>
            <ul className="plain rule-list">
              {pending.map((q) => (
                <li key={q.operation.idempotencyKey}>
                  {t("sync.itemLine", { roll: q.operation.payload.rosterNumber, count: q.operation.payload.responses.length, time: new Date(q.operation.recordedAt).toLocaleTimeString() })}
                  {q.attempts > 0 && <span className="hint"> · {t("sync.attempts", { count: q.attempts })}</span>}
                </li>
              ))}
            </ul>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => void sync.syncNow().then(load)} disabled={sync.syncing || !sync.online}>
                {sync.syncing ? t("sync.syncing") : t("sync.syncNow")}
              </button>
              {!sync.online && <span className="pen inline">{t("sync.needsConnection")}</span>}
            </div>
          </>
        )}
        {sync.last?.stoppedBecause && <Banner tone="info"><p>{t(`sync.stopped.${sync.last.stoppedBecause}`)}</p></Banner>}
        {sync.last && !sync.last.stoppedBecause && sync.last.sent > 0 && (
          <Banner tone="ok"><p>{t("sync.lastResult", { applied: sync.last.applied, duplicates: sync.last.duplicates, conflicts: sync.last.conflicts, rejected: sync.last.rejected })}</p></Banner>
        )}
      </section>

      {rejected.length > 0 && (
        <section aria-labelledby="rej-h">
          <h2 id="rej-h">{t("sync.refused", { count: rejected.length })}</h2>
          <ul className="plain rule-list">
            {rejected.map((q) => (
              <li key={q.operation.idempotencyKey}>
                {t("sync.refusedLine", { roll: q.operation.payload.rosterNumber })}: {q.message}{" "}
                <button className="btn btn-sm" onClick={() => void dismissRejected(q.operation.idempotencyKey).then(() => sync.refresh()).then(load)}>{t("sync.dismiss")}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="con-h">
        <h2 id="con-h">{t("sync.conflicts")}</h2>
        <p className="pen">{t("sync.conflictsHelp")}</p>
        {error && <Banner tone="info"><p>{error}</p></Banner>}
        {conflicts && conflicts.length === 0 && <div className="state-empty"><p>{t("sync.noConflicts")}</p></div>}
        {conflicts?.map((c) => (
          <article key={c.id} className="slip tilt" style={{ marginBottom: "var(--s4)" }}>
            <p>
              <strong>{c.assessmentTitle}</strong> · {t("offline.roll")} {c.rosterNumber}
              {c.studentName ? ` (${c.studentName})` : ""} · {t("sync.recordedAt", { time: new Date(c.recordedAt).toLocaleString() })}
            </p>
            <p>{c.explanation}</p>
            <div className="actions-inline">
              {c.canApply && <button className="btn btn-primary btn-sm" onClick={() => void resolve(c.id, "apply")}>{t("sync.applyMatching")}</button>}
              <button className="btn btn-sm btn-danger" onClick={() => void resolve(c.id, "discard")}>{t("sync.discard")}</button>
            </div>
          </article>
        ))}
        {status && (
          <p className="hint">{t("sync.serverTotals", { applied: status.applied, conflicts: status.conflicts, rejected: status.rejected })}</p>
        )}
      </section>
    </>
  );
}
