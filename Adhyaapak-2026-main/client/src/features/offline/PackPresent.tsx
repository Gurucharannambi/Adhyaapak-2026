import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { OfflinePackDto } from "@adhyaapak/shared";
import { Deck } from "../lessons/PresentationPage";
import { getLocalPack } from "./packs";

/** Presentation mode fed from the pack on this device, so it works with no connection and shows no student data. */
export function PackPresent() {
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
  return (
    <Deck presentation={pack.presentation} />
  );
}
