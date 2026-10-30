import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import type { DashboardResponse } from "@adhyaapak/shared";
import { isWideRoute } from "../hooks/usePalette";
import { useBodyClass } from "../hooks/useBodyClass";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../features/auth/AuthContext";
import { SyncBadge, SyncProvider, useSync } from "../features/offline/SyncContext";
import { Icon } from "../components/ui";
import { useAppConfig } from "./ConfigContext";
import { initials } from "../utils/initials";

export function Layout({ children }: { children?: ReactNode } = {}) {
  return (
    <SyncProvider>
      <Shell>{children}</Shell>
    </SyncProvider>
  );
}

/** Unsynced work is never out of sight: the chip turns sun-yellow whenever something is waiting or refused. */
function SyncChip() {
  const { t } = useTranslation();
  const s = useSync();
  const calm = s.online && s.rejected === 0 && s.pending === 0;
  return (
    <Link to="/sync" className={calm ? "sync is-calm" : "sync is-attn"}>
      <Icon name={calm ? "ok" : "warn"} />
      <SyncBadge label={(x) => (!x.online ? t("sync.badgeOffline", { count: x.pending }) : x.rejected > 0 ? t("sync.badgeRefused", { count: x.rejected }) : x.pending > 0 ? t("sync.badgePending", { count: x.pending }) : t("sync.badgeSynced"))} />
    </Link>
  );
}

function UserMenu({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="st-user" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="who-name">{name}</span>
        <span className="av sun" aria-hidden="true">
          {initials(name)}
        </span>
      </button>
      {open && (
        <div className="st-menu" role="menu">
          <p>{t("shell.signedInAs", { defaultValue: "Signed in as {{name}}", name })}</p>
          <Link role="menuitem" to="/classes" onClick={() => setOpen(false)}>
            {t("shell.manageClasses", { defaultValue: "Classes and timetables" })}
          </Link>
          <Link role="menuitem" to="/sync" onClick={() => setOpen(false)}>
            {t("shell.sync", { defaultValue: "Sync status" })}
          </Link>
          <button role="menuitem" type="button" onClick={onSignOut}>
            {t("common.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const { appName } = useAppConfig();
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  // One look for every signed-in page (styles/studio.css).
  useBodyClass("studio");
  // The shell's two live facts: what needs the teacher, and a lesson that is running now. Both from stored records.
  const day = useApi<DashboardResponse>("/dashboard", { refreshMs: 60000 });
  const needs = (day.data?.attention ?? []).reduce((n, a) => n + a.count, 0);
  const live = (day.data?.schedule ?? []).find((p) => p.lesson && (p.run === "teaching" || p.run === "checking" || p.run === "paused"));
  const items: Array<[string, string, boolean?]> = [
    ["/", t("nav.dashboard"), true],
    ["/classes", t("nav.classes")],
    ["/curriculum", t("nav.curriculum")],
    ["/assessments", t("nav.assessments")],
    ["/insights", t("nav.insights")],
    ["/atlas", t("nav.atlas")],
    ["/offline", t("nav.offline")],
  ];
  return (
    <>
      <a className="skip" href="#main">
        {t("common.skipToContent", { defaultValue: "Skip to content" })}
      </a>
      <header className="st-top">
        <div className="st-top-in">
          <Link to="/" className="st-brand" aria-label={appName}>
            {appName}
            <span aria-hidden="true">.</span>
          </Link>
          <nav aria-label="Main" className="st-nav">
            <ul>
              {items.map(([to, label, end]) => (
                <li key={to}>
                  <NavLink to={to} end={end}>
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="st-end">
            {live && !pathname.startsWith(`/classes/${live.classId}/lessons/`) && (
              <Link className="st-live" to={`/classes/${live.classId}/lessons/${live.lesson!.conceptId}`}>
                <i aria-hidden="true" />
                {t("shell.live", { defaultValue: "{{cls}}: {{lesson}}", cls: live.className, lesson: live.lesson!.title })}
              </Link>
            )}
            <SyncChip />
            <Link to="/#needs" className="st-icon" aria-label={t("shell.needs", { defaultValue: "Needs you: {{count}}", count: needs })}>
              <Icon name="bell" />
              {needs > 0 && <span className="st-badge">{needs > 99 ? "99+" : needs}</span>}
            </Link>
            {user && <UserMenu name={user.name} onSignOut={() => void logout()} />}
          </div>
        </div>
      </header>
      <main id="main" className={isWideRoute(pathname) ? "page wide" : "page"}>
        <div className="sheet">{children ?? <Outlet />}</div>
      </main>
    </>
  );
}
