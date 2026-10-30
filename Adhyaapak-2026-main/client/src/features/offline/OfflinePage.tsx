import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, PageHead } from "../../components/ui";
import { Link } from "react-router";
import type { OfflinePackDto } from "@adhyaapak/shared";
import { listLocalPacks, preflight, removePack, type PreflightCheck } from "./packs";
import { useSync } from "./SyncContext";

/** The packs saved on this device. Everything here is read from IndexedDB, so it opens with no connection. */
export function OfflinePage() {
  const { t } = useTranslation();
  const sync = useSync();
  const [packs, setPacks] = useState<OfflinePackDto[]>();
  const [checks, setChecks] = useState<Record<string, PreflightCheck[]>>({});
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setPacks(await listLocalPacks());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.unexpectedError"));
      setPacks([]);
    }
  }, [t]);
  useEffect(() => void load(), [load]);

  return (
    <>
      <PageHead title={t("offline.title")} lede={t("offline.intro")} />
      <p>
        <span className={sync.online ? "chip ok" : "chip check"}>{sync.online ? t("offline.online") : t("offline.offlineNow")}</span> · <Link to="/sync">{t("sync.open")}</Link>
      </p>
      {error && <Banner tone="err"><p>{error}</p></Banner>}

      <h2>{t("offline.packsHeading")}</h2>
      {packs === undefined ? (
        <p className="state-loading" role="status">{t("common.loading")}</p>
      ) : packs.length === 0 ? (
        <div className="state-empty"><p>{t("offline.noPacks")}</p></div>
      ) : (
        <ul className="plain">
          {packs.map((p) => (
            <li key={p.id} className="q-card">
              <h3 style={{ margin: 0 }}>{p.conceptTitle}</h3>
              <p className="muted" style={{ margin: 0 }}>{p.className} · {t("offline.builtOn", { date: new Date(p.builtAt).toLocaleString() })}</p>
              <p><span className="chip ok">✓ {t("offline.availableOffline")}</span></p>
              <div className="actions-inline">
                <Link className="btn btn-primary btn-sm" to={`/offline/packs/${p.id}`}>{t("offline.openPack")}</Link>
                <button className="btn btn-sm" onClick={() => void preflight(p).then((r) => setChecks((c) => ({ ...c, [p.id]: r })))}>{t("offline.check")}</button>
                <button className="btn btn-sm btn-danger"
                  onClick={() => {
                    if (window.confirm(t("offline.removeConfirm"))) void removePack(p.id).then(load);
                  }}
                >
                  {t("offline.remove")}
                </button>
              </div>
              {checks[p.id] && checks[p.id]!.length > 0 && (
                <>
                  <p style={{ marginTop: "var(--s3)" }}>
                    <strong>{checks[p.id]!.every((c) => c.ok) ? `✓ ${t("offline.ready", { count: checks[p.id]!.reduce((n, c) => n + (c.items ?? 0), 0) })}` : `⚠ ${t("offline.notReady")}`}</strong>
                  </p>
                  <ul className="plain">
                    {checks[p.id]!.map((c) => (
                      <li key={c.id}>
                        {c.ok ? "✓" : "✗"} {c.detail}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="pen">{t("offline.privacy")}</p>
    </>
  );
}
