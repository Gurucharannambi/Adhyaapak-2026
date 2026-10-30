import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ResourceDto, TeachingLevel, TranslationsResponse } from "@adhyaapak/shared";
import { useApi } from "../../hooks/useApi";
import { Banner } from "../../components/ui";
import { ResourceView } from "./ResourceView";

const asResource = (title: string, content: Record<string, unknown>, language: string): ResourceDto =>
  ({ id: "view", type: "explanation", level: null, title, language, content, provenance: { source: "original" }, reviewStatus: "approved" }) as ResourceDto;

/**
 * Teacher-only, side by side: the explanation in its own language next to a translation. Mathematical notation is
 * shown exactly as stored, so a teacher can check numbers and symbols line up. A translation stays marked as a draft
 * until a person who reads the language approves it, and students never see it before then.
 */
export function BilingualView({ conceptId, level }: { conceptId: string; level: TeachingLevel }) {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<string>();
  const state = useApi<TranslationsResponse>(`/concepts/${conceptId}/translations${language ? `?language=${language}` : ""}`);
  const data = state.data;
  if (!data || data.available.length === 0) return null;

  const row = data.levels.find((l) => l.level === level);
  const tr = row?.translations[0];
  return (
    <section aria-labelledby="bi-h">
      <h2 id="bi-h">{t("bilingual.title")}</h2>
      <p className="hint">{t("bilingual.help")}</p>
      {data.available.length > 1 && (
        <div className="field">
          <label htmlFor="bi-lang">{t("bilingual.language")}</label>
          <select id="bi-lang" value={language ?? data.available[0]} onChange={(e) => setLanguage(e.target.value)}>
            {data.available.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      )}
      {!tr ? (
        <div className="state-empty"><p>{t("bilingual.none")}</p></div>
      ) : (
        <>
          {tr.reviewStatus !== "approved" && (
            <Banner tone="warn">
              <p>
                <strong>{t("bilingual.draft")}</strong> {tr.note ?? ""}
              </p>
            </Banner>
          )}
          <div className="grid-2">
            <div lang={data.language}>
              <p>
                <small>{data.language}</small>
              </p>
              {row?.original ? <ResourceView resource={asResource(row.original.title, row.original.content, data.language)} /> : <div className="state-empty"><p>{t("bilingual.noOriginal")}</p></div>}
            </div>
            <div lang={tr.language}>
              <p>
                <small>{tr.language}</small>
              </p>
              <ResourceView resource={asResource(tr.title, tr.content, tr.language)} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
