import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MasteryStatus } from "@adhyaapak/shared";

/**
 * Shared parts of the "ink and notebook" design (requirements/adhyaapak-design). Each does one job and carries no business logic.
 * Class names come from styles/design.css.
 */

const ICONS = {
  ok: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  warn: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.1" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="1" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  print: <><path d="M7 9V3h10v6" /><rect x="4" y="9" width="16" height="8" rx="1" /><path d="M7 14h10v7H7z" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.2a4.5 4.5 0 0 1 5 4.8" /></>,
  cap: <><path d="M2.5 9 12 4.5 21.5 9 12 13.5z" /><path d="M6.5 11v4.5c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3V11" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  arrowL: <path d="M19 12H5m6-6-6 6 6 6" />,
  arrowR: <path d="M5 12h14m-6-6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  up: <path d="m6 15 6-6 6 6" />,
  live: <><circle cx="12" cy="12" r="3" /><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4" /></>,
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

/** The product mark: three linked concepts, as on the landing page. Takes the palette's accent colour. */
export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="7" cy="24" r="3.2" />
      <circle cx="16" cy="9" r="3.2" />
      <circle cx="25" cy="22" r="3.2" />
      <path d="M9 21.5 14 12M18 11.5 23.5 19.5M10.2 24h11.6" />
    </svg>
  );
}

/** The teacher's red-pen margin note: where the app explains itself. Keep it to a sentence. */
export function MarginNote({ children, inline = false }: { children: ReactNode; inline?: boolean }) {
  return <span className={inline ? "pen inline" : "pen"} style={inline ? undefined : { display: "block" }}>{children}</span>;
}

export type ChipTone = "pen" | "decide" | "draft" | "check" | "ai" | "ok" | "rec" | "sug" | "role" | "private";
export function Chip({ children, tone }: { children: ReactNode; tone?: ChipTone }) {
  const cls = tone === "pen" ? "ai" : tone;
  return <span className={cls ? `chip ${cls}` : "chip"}>{children}</span>;
}

/** Success / error / info / warning message. Errors are announced (role="alert"). */
export function Banner({ tone, children }: { tone: "ok" | "err" | "info" | "warn"; children: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role={tone === "err" ? "alert" : "status"}>
      <Icon name={tone === "ok" ? "ok" : tone === "info" ? "info" : "warn"} />
      <div>{children}</div>
    </div>
  );
}

/** A label, control, hint and inline error wired together for assistive technology. */
export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string | undefined; error?: string | undefined; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="hint" id={`${id}-h`}>{hint}</p>}
      {error && <FieldError id={`${id}-e`}>{error}</FieldError>}
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="field-err" id={id} role="alert">
      <Icon name="warn" />
      <span>{children}</span>
    </p>
  );
}

/** Page title block with an optional back link and one-line description. */
export function PageHead({ title, lede, back, eyebrow }: { title: ReactNode; lede?: ReactNode; back?: ReactNode; eyebrow?: string }) {
  return (
    <div className="page-head">
      {back}
      {eyebrow && <span className="mono eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
    </div>
  );
}

/** White page with the red margin line. */
export function Sheet({ children, flat = false }: { children: ReactNode; flat?: boolean }) {
  return <div className={flat ? "sheet flat" : "sheet"}>{children}</div>;
}

/** How full each status circle is. The shape carries the meaning; colour only supports it. */
const GLYPH_PATH: Record<MasteryStatus, ReactNode> = {
  not_enough_evidence: <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.6 3" />,
  needs_foundation: (
    <>
      <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M11 11V2A9 9 0 0 1 20 11Z" fill="currentColor" />
    </>
  ),
  developing: (
    <>
      <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M11 2A9 9 0 0 1 11 20Z" fill="currentColor" />
    </>
  ),
  likely_secure: (
    <>
      <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M11 11V2A9 9 0 1 1 2 11Z" fill="currentColor" />
    </>
  ),
  ready_for_challenge: (
    <>
      <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="11" cy="11" r="6" fill="currentColor" />
      <circle cx="11" cy="11" r="10.2" fill="none" stroke="currentColor" strokeWidth="1" />
    </>
  ),
};

/** Plain-text twins of the drawn circles, for places that cannot hold an SVG (printed text, lists in tests). */
export const STATUS_GLYPH: Record<MasteryStatus, string> = {
  not_enough_evidence: "○",
  needs_foundation: "◔",
  developing: "◑",
  likely_secure: "◕",
  ready_for_challenge: "●",
};

export function StatusGlyph({ status, size = 22 }: { status: MasteryStatus; size?: number }) {
  return (
    <svg viewBox="0 0 22 22" width={size} height={size} aria-hidden="true" focusable="false" style={{ flex: "none", verticalAlign: "middle" }}>
      {GLYPH_PATH[status]}
    </svg>
  );
}

/** A learning status as shape + words (never colour alone). `words` lets the student portal use its friendlier labels. */
export function StatusMark({ status, words }: { status: MasteryStatus; words?: string }) {
  const { t } = useTranslation();
  return (
    <span className={status === "not_enough_evidence" ? "mark s-nee" : "mark"}>
      <StatusGlyph status={status} />
      <span>{words ?? t(`status.${status}`)}</span>
    </span>
  );
}

/** An empty screen is an invitation to act: say what is missing and what to do next. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state-empty">
      <p>
        <strong>{title}</strong>
      </p>
      {children}
    </div>
  );
}
