import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { OfflinePackDto } from "@adhyaapak/shared";
import { ApiRequestError, api } from "../../services/api";
import { estimatePackBytes, savePack, storageRoom } from "./packs";

/** Builds a lesson pack on the server and stores it on this device, after checking there is room. */
export function PrepareOffline({ classId, conceptId }: { classId: string; conceptId: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [pack, setPack] = useState<OfflinePackDto>();

  async function prepare() {
    setBusy(true);
    setError(undefined);
    try {
      const built = await api<OfflinePackDto>(`/lessons/${conceptId}/offline-packs`, { method: "POST", body: { classId } });
      const room = await storageRoom(estimatePackBytes(built));
      if (!room.ok) throw new ApiRequestError("validation_error", room.detail, 0);
      await savePack(built);
      setPack(built);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="row">
      <button className="btn" onClick={() => void prepare()} disabled={busy}>
        {busy ? t("offline.preparing") : t("offline.prepare")}
      </button>
      {pack && (
        <>
          {" "}
          <span role="status" className="chip ok">✓ {t("offline.saved")}</span> <Link to={`/offline/packs/${pack.id}`}>{t("offline.openPack")}</Link>
        </>
      )}
      {error && (
        <span role="alert" className="chip check" style={{ whiteSpace: "normal" }}>
          {error}
        </span>
      )}
    </span>
  );
}
