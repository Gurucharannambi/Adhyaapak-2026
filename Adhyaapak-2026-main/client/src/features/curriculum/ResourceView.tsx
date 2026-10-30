import { useTranslation } from "react-i18next";
import type { ResourceDto } from "@adhyaapak/shared";
import { Manipulative } from "./Manipulative";

/** Renders one teaching resource: summary, picture, steps, worked example, common error and prompt. */
export function ResourceView({ resource }: { resource: ResourceDto }) {
  const { t } = useTranslation();
  const c = resource.content as {
    summary?: string;
    steps?: string[];
    workedExample?: { problem: string; steps: string[] };
    commonError?: string;
    prompt?: string;
    manipulative?: Record<string, unknown>;
  };
  return (
    <article>
      <h3 style={{ marginTop: 0 }}>{resource.title}</h3>
      {c.summary && <p>{c.summary}</p>}
      <Manipulative spec={c.manipulative} />
      {c.steps && (
        <ol>
          {c.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {c.workedExample && (
        <div>
          <p>
            <strong>{t("concept.workedExample")}:</strong> {c.workedExample.problem}
          </p>
          <ol>
            {c.workedExample.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {c.commonError && (
        <p className="pen">
          <b>{t("concept.commonError")}:</b> {c.commonError}
        </p>
      )}
      {c.prompt && (
        <p className="decide-box">
          <strong>{t("concept.tryThis")}:</strong> {c.prompt}
        </p>
      )}
    </article>
  );
}
