import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import type { AttentionItem, ClassDto, DashboardResponse, InsightsResponse, LearningMapResponse, RunState, SchedulePeriod } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { Banner, Field, Icon } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";
import { classLabel } from "../../utils/classLabel";
import { initials } from "../../utils/initials";
import { useAuth } from "../auth/AuthContext";
import { GROWTH_LABEL } from "../insights/GrowthCards";
import { ProgressChart } from "../insights/ProgressChart";

/** The one button a period's state calls for, and where it goes. */
function nextAction(p: SchedulePeriod, t: (k: string, o?: Record<string, unknown>) => string): { label: string; step: string; primary: boolean } {
  const state: RunState = p.run ?? "not_started";
  switch (state) {
    case "teaching":
      return { label: t("today.continueTeaching", { defaultValue: "Continue the lesson" }), step: "teach", primary: true };
    case "checking":
      return { label: t("today.continueCheck", { defaultValue: "Continue the check" }), step: "check", primary: true };
    case "paused":
      return { label: t("today.resumeCheck", { defaultValue: "Resume the check" }), step: "check", primary: true };
    case "needs_wrap":
      return { label: t("today.wrapUp", { defaultValue: "Wrap up" }), step: "wrap", primary: true };
    case "done":
      return { label: t("today.review", { defaultValue: "See results" }), step: "wrap", primary: false };
    default:
      return { label: t("today.prepare", { defaultValue: "Prepare the lesson" }), step: "prepare", primary: true };
  }
}

const STATE_TAG: Record<RunState, { text: string; cls: string }> = {
  not_started: { text: "Not started", cls: "st-chip" },
  teaching: { text: "Teaching", cls: "st-chip sun" },
  checking: { text: "Check running", cls: "st-chip sun" },
  paused: { text: "Paused", cls: "st-chip sun" },
  needs_wrap: { text: "To wrap up", cls: "st-chip sun" },
  done: { text: "Done", cls: "st-chip lime" },
};

const lessonLink = (p: SchedulePeriod, step: string) => `/classes/${p.classId}/lessons/${p.lesson!.conceptId}?step=${step}`;
const weekdayName = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" });

function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const wrapped = (location.state as { wrapped?: { title: string; assigned: number } } | null)?.wrapped;
  const [weekOf, setWeekOf] = useState<string>();
  const state = useApi<DashboardResponse>(`/dashboard${weekOf ? `?week=${weekOf}` : ""}`, { refreshMs: 30000 });
  const [chosen, setChosen] = useState<string>();

  return (
    <AsyncView state={state}>
      {(d) => {
        const schedule = d.schedule ?? [];
        const attention = d.attention ?? [];
        const setup = d.setup ?? { hasClass: d.classes.length > 0, hasStudents: d.classes.some((c) => c.studentCount > 0), hasTaught: false };
        const hero = schedule.find((p) => p.lesson && p.run !== "done") ?? null;
        const students = d.classes.reduce((n, c) => n + c.studentCount, 0);
        const needs = attention.reduce((n, a) => n + a.count, 0);
        const biggest = [...d.classes].sort((a, b) => b.studentCount - a.studentCount)[0];
        const focusId = chosen ?? hero?.classId ?? biggest?.id;
        return (
          <div className="dash">
            <section className="hello" aria-label={t("today.summary", { defaultValue: "Today at a glance" })}>
              <div>
                <h1>
                  {greeting()}, {user?.name}
                </h1>
                <p>{t("today.lede", { defaultValue: "Here's what's happening today" })}</p>
              </div>
              <div className="bignums">
                <Link className="bignum" to="/classes">
                  <Icon name="cap" />
                  <b>{students}</b>
                  <span>{t("today.students", { defaultValue: "Students" })}</span>
                </Link>
                <a className="bignum" href="#periods">
                  <Icon name="clock" />
                  <b>{schedule.length}</b>
                  <span>{t("today.periodsToday", { defaultValue: "Periods today" })}</span>
                </a>
                <a className="bignum" href="#needs">
                  <Icon name="bell" />
                  <b>{needs}</b>
                  <span>{t("today.needsYou", { defaultValue: "Need you" })}</span>
                </a>
              </div>
            </section>

            {wrapped && (
              <Banner tone="ok">
                <p>
                  {t("today.wrapped", { defaultValue: "“{{title}}” is wrapped up.", title: wrapped.title })}
                  {wrapped.assigned > 0 ? ` ${t("today.wrappedAssigned", { defaultValue: "{{n}} students have a next activity.", n: wrapped.assigned })}` : ""}
                </p>
              </Banner>
            )}
            {!(setup.hasClass && setup.hasStudents && setup.hasTaught) && <GettingStarted setup={setup} firstClass={d.classes[0]} />}

            <div className="today-grid">
              <StudentsOverview classes={d.classes} classId={focusId} onClass={setChosen} />
              <Distribution classId={focusId} />
              <aside className="a-side" aria-label={t("today.side", { defaultValue: "Lessons and what needs you" })}>
                <BookGauge classId={focusId} />
                <Lessons hero={hero} tomorrow={d.tomorrow ?? []} focusId={focusId} hasSchedule={schedule.length > 0} classes={d.classes} />
                <NeedsYou items={attention} />
              </aside>
              <section className="glass a-periods" id="periods" aria-labelledby="periods-h">
                <h2 id="periods-h" className="g-title">
                  {t("dashboard.todayTitle")}
                </h2>
                {d.classes.length === 0 ? (
                  <p className="g-note">{t("today.noClassYet", { defaultValue: "Create a class to see its periods here." })}</p>
                ) : schedule.length === 0 ? (
                  <p className="g-note">{t("dashboard.noPeriods")}</p>
                ) : (
                  <PeriodList schedule={schedule} hero={hero} classes={d.classes} />
                )}
              </section>
              <WeekCalendar week={d.week ?? []} weekStart={d.weekStart} classes={d.classes} onWeek={setWeekOf} />
            </div>
          </div>
        );
      }}
    </AsyncView>
  );
}

/**
 * Students Overview: the focus class's roster, two at a time, in roster order (never ranked). Each card shows what the
 * records say: the latest concept answered, how many answers are recorded, and how many concepts read as secure.
 */
function StudentsOverview({ classes, classId, onClass }: { classes: ClassDto[]; classId: string | undefined; onClass: (id: string) => void }) {
  const map = useApi<LearningMapResponse>(classId ? `/classes/${classId}/learning-map` : null);
  const insights = useApi<InsightsResponse>(classId ? `/classes/${classId}/insights` : null);
  const [page, setPage] = useState(0);
  const students = map.data?.students ?? [];
  const pages = Math.max(1, Math.ceil(students.length / 2));
  const at = Math.min(page, pages - 1);
  const growthOf = new Map<string, string>();
  for (const g of insights.data?.growth ?? []) for (const s of g.students) if (!growthOf.has(s.studentId)) growthOf.set(s.studentId, GROWTH_LABEL[g.key].title);
  const conceptTitle = new Map((map.data?.concepts ?? []).map((c) => [c.id, c.title]));
  return (
    <section className="glass a-students" aria-labelledby="students-h">
      <div className="g-head">
        <h2 id="students-h" className="g-title">
          Students Overview
        </h2>
        <span className="row" style={{ gap: 8 }}>
          {classes.length > 1 && classId && (
            <select className="pill-select" aria-label="Class" value={classId} onChange={(e) => (onClass(e.target.value), setPage(0))}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c, classes)}
                </option>
              ))}
            </select>
          )}
          {students.length > 2 && (
            <span className="pager">
              <button type="button" aria-label="Previous students" disabled={at === 0} onClick={() => setPage(at - 1)}>
                <Icon name="arrowL" />
              </button>
              <span aria-live="polite">
                {at + 1} / {pages}
              </span>
              <button type="button" aria-label="Next students" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
                <Icon name="arrowR" />
              </button>
            </span>
          )}
        </span>
      </div>
      {!classId ? (
        <p className="g-note">Create a class and add students to see them here.</p>
      ) : students.length === 0 ? (
        <p className="g-note">{map.loading ? "Loading…" : "No students on this roster yet."}</p>
      ) : (
        <ul className="rec-cards plain">
          {students.slice(at * 2, at * 2 + 2).map((s) => {
            const cells = Object.entries(s.cells).filter(([, c]) => c.evidenceCount > 0);
            const answers = cells.reduce((n, [, c]) => n + c.evidenceCount, 0);
            const secure = cells.filter(([, c]) => c.status === "likely_secure" || c.status === "ready_for_challenge").length;
            const latest = cells.at(-1);
            return (
              <li key={s.id} className="rec-card">
                <div className="top">
                  <div>
                    <h3>{s.name}</h3>
                    <span className="role">{growthOf.get(s.id) ?? `Roll ${s.rosterNumber}`}</span>
                  </div>
                  <Link className="mini-link" to={`/classes/${classId}/students/${s.id}`}>
                    View Details
                  </Link>
                </div>
                <div className="face" aria-hidden="true">
                  <span className="av xl">{initials(s.name)}</span>
                </div>
                <p className="why">
                  Concept: <b>{latest ? (conceptTitle.get(latest[0]) ?? "—") : "No answers yet"}</b>
                </p>
                <div className="foot">
                  <span>
                    Answers: <b>{answers}</b>
                  </span>
                  <span className="st-chip">
                    Secure: {secure}/{cells.length}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Distribution({ classId }: { classId: string | undefined }) {
  const insights = useApi<InsightsResponse>(classId ? `/classes/${classId}/insights` : null);
  return (
    <section className="glass a-chart" aria-labelledby="dist-h">
      <div className="g-head">
        <h2 id="dist-h" className="g-title">
          Learning Progress Distribution
        </h2>
        {classId && (
          <Link className="pill-btn sm" to={`/insights?class=${classId}`}>
            View Details
          </Link>
        )}
      </div>
      {!classId ? (
        <p className="g-note">Appears once a class has recorded answers.</p>
      ) : (
        <AsyncView state={insights}>
          {(i) => (
            <ProgressChart
              byStatus={i.distribution.byStatus}
              caption={
                i.distribution.concepts === 0
                  ? `No recorded answers in ${i.className} yet. Bars fill in after a check in a lesson.`
                  : `${i.className}: ${i.studentCount} students × ${i.distribution.concepts} concepts with answers = ${i.distribution.cells} pairs. “Not enough” is a gap in evidence, not a weakness.`
              }
            />
          )}
        </AsyncView>
      )}
    </section>
  );
}

/** Lessons of the class's book recorded as taught: the reference's half gauge, sitting behind the Lessons card. */
function BookGauge({ classId }: { classId: string | undefined }) {
  const tt = useApi<{ lessonsTaught: number; lessonsTotal: number; className: string }>(classId ? `/classes/${classId}/timetable` : null);
  if (!classId || !tt.data || tt.data.lessonsTotal === 0) return <div className="gauge-spacer" />;
  const { lessonsTaught: taught, lessonsTotal: total } = tt.data;
  const share = taught / total;
  const r = 104;
  const len = Math.PI * r;
  return (
    <Link className="gauge" to={`/classes/${classId}/timetable`} aria-label={`Book progress: ${taught} of ${total} lessons taught in ${tt.data.className}`}>
      <svg viewBox="0 0 260 132" aria-hidden="true">
        <path d="M26 130a104 104 0 0 1 208 0" fill="none" stroke="#d3f0c2" strokeWidth="44" />
        <path d="M26 130a104 104 0 0 1 208 0" fill="none" stroke="#5cc83a" strokeWidth="44" strokeDasharray={`${Math.max(len * share, 2)} ${len}`} />
      </svg>
      <span className="read">
        <b>{Math.round(share * 100)}%</b>
        <span>Book Progress</span>
      </span>
    </Link>
  );
}

/** The reference's "Live Sessions": today's lesson and the next one, each with its single next action. */
function Lessons({ hero, tomorrow, focusId, hasSchedule, classes }: { hero: SchedulePeriod | null; tomorrow: SchedulePeriod[]; focusId: string | undefined; hasSchedule: boolean; classes: ClassDto[] }) {
  const { t } = useTranslation();
  const a = hero ? nextAction(hero, t) : null;
  const next = tomorrow.find((p) => p.classId === focusId) ?? tomorrow[0];
  const size = (id: string) => {
    const n = classes.find((c) => c.id === id)?.studentCount ?? 0;
    return `${n} ${n === 1 ? "Student" : "Students"}`;
  };
  const name = (p: SchedulePeriod) => {
    const c = classes.find((x) => x.id === p.classId);
    return c ? classLabel(c, classes) : p.className;
  };
  return (
    <section className="glass lessons-card" aria-labelledby="now-h">
      <h2 id="now-h" className="g-title">
        {t("today.lessonsTitle", { defaultValue: "Lessons" })}
      </h2>
      <span className="tag sun">{t("today.todayTag", { defaultValue: "Today" })}</span>
      {hero ? (
        <div className="session">
          <div className="row1">
            <strong>{hero.lesson!.title}</strong>
            <span>
              {weekdayName(hero.date)}, {hero.startsAt}–{hero.endsAt}
            </span>
          </div>
          <Link className="art-link" to={lessonLink(hero, a!.step)}>
            <SessionArt kind="board" />
            <span className="art-cta">{a!.label}</span>
          </Link>
          <div className="row2">
            <span>{size(hero.classId)}</span>
            <span>
              Class <b>{name(hero)}</b>
            </span>
          </div>
        </div>
      ) : (
        <p className="g-note" style={{ margin: "14px 0 0" }}>
          {hasSchedule ? t("today.allDone", { defaultValue: "Every lesson planned for today is wrapped up." }) : t("today.nothingPlanned", { defaultValue: "No lessons planned for today." })}
        </p>
      )}
      {next && (
        <div className="session">
          <span className="tag grey" style={{ marginTop: 18 }}>
            {t("today.upcoming", { defaultValue: "Upcoming" })}
          </span>
          <div className="row1">
            <strong>{next.lesson!.title}</strong>
            <span>
              {weekdayName(next.date)}, {next.startsAt}–{next.endsAt}
            </span>
          </div>
          <Link className="art-link" to={lessonLink(next, "prepare")}>
            <SessionArt kind="tiles" />
            <span className="art-cta">{t("today.getReady", { defaultValue: "Get ready" })}</span>
          </Link>
          <div className="row2">
            <span>{size(next.classId)}</span>
            <span>
              Class <b>{name(next)}</b>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

const TILES: Array<[number, number, number, string]> = [
  [8, 10, -8, "1/2"],
  [56, 4, 6, "2/4"],
  [104, 16, -4, "3/6"],
  [152, 6, 10, "4/8"],
  [200, 14, -10, "1/3"],
  [30, 52, 8, "="],
  [80, 56, -6, "2/6"],
  [128, 50, 4, "5/10"],
  [176, 58, -8, "6/9"],
  [224, 50, 6, "?"],
];

/** Small drawings for the lesson cards: a chalkboard of fraction bars, and fraction tiles. Illustrations, never photos. */
function SessionArt({ kind }: { kind: "board" | "tiles" }) {
  if (kind === "tiles")
    return (
      <svg className="art" viewBox="0 0 280 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="280" height="100" fill="#efe6cf" />
        {TILES.map(([x, y, r, s], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${r} 22 20)`}>
            <rect width="44" height="40" rx="6" fill="#f7f0dc" stroke="#d9c79b" />
            <text x="22" y="26" textAnchor="middle" fontSize="15" fontWeight="600" fill="#3a2f1b" fontFamily="IBM Plex Sans, sans-serif">
              {s}
            </text>
          </g>
        ))}
      </svg>
    );
  return (
    <svg className="art" viewBox="0 0 280 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="280" height="100" fill="#1f2a26" />
      <g fill="none" stroke="#f4efe2" strokeOpacity=".7" strokeWidth="1.4">
        <rect x="18" y="18" width="120" height="16" rx="3" />
        <path d="M78 18v16" />
        <rect x="18" y="50" width="120" height="16" rx="3" />
        <path d="M48 50v16M78 50v16M108 50v16" />
        <path d="M160 26q14-12 28 0M160 44h40M168 58q10 8 26 0M214 30l20 24M234 30l-20 24" strokeOpacity=".45" />
      </g>
      <rect x="19" y="19" width="59" height="14" fill="#f2c14e" fillOpacity=".8" />
      <rect x="19" y="51" width="59" height="14" fill="#8fdc6c" fillOpacity=".75" />
      <text x="164" y="86" fill="#f4efe2" fillOpacity=".75" fontSize="14" fontFamily="IBM Plex Sans, sans-serif">
        1/2 = 2/4
      </text>
    </svg>
  );
}

/** The reference's "Attendance Overview": four fixed lines, each a real count from the records, each leading to the work. */
function NeedsYou({ items }: { items: AttentionItem[] }) {
  const { t } = useTranslation();
  const rows: Array<[AttentionItem["kind"], string]> = [
    ["check_open", t("today.need.check_open", { defaultValue: "Checks open" })],
    ["needs_wrap", t("today.need.needs_wrap", { defaultValue: "To wrap up" })],
    ["paper_review", t("today.need.paper_review", { defaultValue: "Sheets to review" })],
    ["pattern_confirm", t("today.need.pattern_confirm", { defaultValue: "Patterns to confirm" })],
  ];
  return (
    <section className="glass" id="needs" aria-labelledby="needs-h">
      <h2 id="needs-h" className="g-title">
        {t("today.needsYouTitle", { defaultValue: "Needs you" })}
      </h2>
      <ul className="kvlist">
        {rows.map(([kind, label]) => {
          const mine = items.filter((i) => i.kind === kind);
          const n = mine.reduce((s, i) => s + i.count, 0);
          return (
            <li key={kind}>
              {n > 0 ? (
                <Link to={mine[0]!.href} title={mine.map((i) => i.text).join(" ")}>
                  {label} :
                </Link>
              ) : (
                <span>{label} :</span>
              )}
              <b>{n}</b>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Today's periods: the reference's "Meetings Completion", one row per period with its status. */
function PeriodList({ schedule, hero, classes }: { schedule: SchedulePeriod[]; hero: SchedulePeriod | null; classes: ClassDto[] }) {
  const { t } = useTranslation();
  const name = (p: SchedulePeriod) => {
    const c = classes.find((x) => x.id === p.classId);
    return c ? classLabel(c, classes) : p.className;
  };
  return (
    <ol className="acc">
      {schedule.map((p, i) => {
        const tag = p.lesson ? STATE_TAG[p.run ?? "not_started"] : null;
        const a = p.lesson ? nextAction(p, t) : null;
        return (
          <li key={`${p.classId}-${p.period}`}>
            <details open={hero ? p === hero : i === 0}>
              <summary>
                <span>
                  Period {p.period} · {name(p)} {tag && <span className={tag.cls}>{tag.text}</span>}
                </span>
                <Icon name="down" />
              </summary>
              <div className="body">
                <p>
                  {p.subject}
                  {p.lesson ? ` : ${p.lesson.title}` : ""} <span className="g-note">· {p.startsAt}–{p.endsAt}</span>
                </p>
                {!p.lesson && <p className="g-note">{p.noLesson === "book_finished" ? t("today.bookDone", { defaultValue: "The textbook is finished for this class." }) : t("today.noTextbook", { defaultValue: "No textbook for this subject yet, so no lesson is planned." })}</p>}
                {p.lesson && p !== hero && a && (
                  <Link className="pill-btn light sm" to={lessonLink(p, a.step)}>
                    {a.label}
                  </Link>
                )}
                {p === hero && <span className="g-note">{t("today.seeNow", { defaultValue: "Its next step is in Lessons, on the right." })}</span>}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const x = new Date(y, m - 1, d + n, 12);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/** The week's Mathematics lessons from the real timetable, with the previous and next week a click away. */
function WeekCalendar({ week, weekStart, classes, onWeek }: { week: SchedulePeriod[]; weekStart: string | undefined; classes: ClassDto[]; onWeek: (w: string) => void }) {
  if (!weekStart)
    return (
      <section className="glass a-week" aria-label="This week">
        <p className="g-note">The week appears once a class has a timetable.</p>
      </section>
    );
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dates = DAYS.map((_, i) => addDays(weekStart, i));
  // Lessons only: other subjects have no textbook here, and the full timetable has its own page.
  const lessons = week.filter((p) => p.lesson);
  const startH = 8;
  const endH = 14;
  const px = 21; // per half hour: 8:00 to 14:00 fits the card
  const month = new Date(`${weekStart}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const label = (h: number) => `${String(((h + 11) % 12) + 1).padStart(2, "0")}:00 ${h < 12 ? "am" : "pm"}`;
  const short = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <section className="glass a-week" aria-labelledby="week-h">
      <div className="cal-head">
        <button type="button" className="tag" onClick={() => onWeek(addDays(weekStart, -7))} aria-label={`Previous week, from ${short(addDays(weekStart, -7))}`}>
          ‹ {short(addDays(weekStart, -7))}
        </button>
        <h2 id="week-h">{month}</h2>
        <button type="button" className="tag" onClick={() => onWeek(addDays(weekStart, 7))} aria-label={`Next week, from ${short(addDays(weekStart, 7))}`}>
          {short(addDays(weekStart, 7))} ›
        </button>
      </div>
      <div className="week-wrap">
        <div className="week">
          <div />
          {dates.map((d, i) => (
            <div key={d} className={d === today ? "dhead today" : "dhead"}>
              {DAYS[i]}
              <small>{Number(d.slice(8, 10))}</small>
            </div>
          ))}
          <div className="times" aria-hidden="true" style={{ height: (endH - startH) * 2 * px }}>
            {[8, 10, 12, 14].map((h) => (
              <span key={h} style={{ top: (h - startH) * 2 * px }}>
                {label(h)}
              </span>
            ))}
          </div>
          {dates.map((d) => {
            const day = lessons.filter((p) => p.date === d);
            return (
              <div key={d} className="col" style={{ height: (endH - startH) * 2 * px }} role="list" aria-label={`${weekdayName(d)}: ${day.length} lessons`}>
                {day.map((p) => {
                  const top = Math.max(0, ((toMin(p.startsAt) - startH * 60) / 30) * px);
                  const same = day.filter((x) => Math.abs(toMin(x.startsAt) - toMin(p.startsAt)) < 40);
                  const idx = same.indexOf(p);
                  const live = p.run === "teaching" || p.run === "checking" || p.run === "paused";
                  const c = classes.find((x) => x.id === p.classId);
                  return (
                    <Link
                      key={`${p.classId}-${p.period}`}
                      role="listitem"
                      className={`ev${live ? " live" : ""}${p.run === "done" ? " done" : ""}`}
                      style={{ top: top + idx * 6, left: 4 + idx * 8, zIndex: 1 + idx }}
                      to={`/classes/${p.classId}/lessons/${p.lesson!.conceptId}`}
                    >
                      <strong>{p.lesson!.title}</strong>
                      <span>
                        {c ? classLabel(c, classes) : p.className} · {p.startsAt}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="g-note" style={{ marginTop: 8 }}>
        Mathematics lessons from the timetable. Other subjects are on each class's timetable page.
      </p>
    </section>
  );
}

function GettingStarted({ setup, firstClass }: { setup: { hasClass: boolean; hasStudents: boolean; hasTaught: boolean }; firstClass: ClassDto | undefined }) {
  const { t } = useTranslation();
  const steps: Array<{ done: boolean; text: string; to: string; help: string }> = [
    { done: setup.hasClass, text: t("today.setup.class", { defaultValue: "Create your class" }), to: "/classes#create-class", help: t("dashboard.note.create_first_class") },
    { done: setup.hasStudents, text: t("today.setup.students", { defaultValue: "Add your students" }), to: firstClass ? `/classes/${firstClass.id}#roster-h` : "/classes#create-class", help: t("dashboard.note.add_students") },
    { done: setup.hasTaught, text: t("today.setup.lesson", { defaultValue: "Teach your first lesson" }), to: firstClass ? `/classes/${firstClass.id}/timetable` : "/classes#create-class", help: t("today.setup.lessonHelp", { defaultValue: "Your timetable already plans it. Open it from Today's periods." }) },
  ];
  return (
    <section aria-labelledby="start-h" className="glass" style={{ marginBottom: 20 }}>
      <h2 id="start-h" className="g-title">
        {t("today.gettingStarted", { defaultValue: "Getting started" })}
      </h2>
      <ol className="plain kvlist">
        {steps.map((s) => (
          <li key={s.text} style={{ justifyContent: "flex-start" }}>
            <span className={s.done ? "tick on" : "tick"} aria-hidden="true">
              {s.done ? "✓" : ""}
            </span>
            <span>
              <Link to={s.to}>{s.text}</Link>
              {s.done && <span className="sr-only"> ({t("today.setup.done", { defaultValue: "done" })})</span>}
              <span className="g-note" style={{ display: "block" }}>
                {s.help}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Creating a class. Lives on the Classes page; exported so that page reuses it. */
export function CreateClassForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("6");
  const [year, setYear] = useState("2026-27");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api("/classes", { method: "POST", body: { name, grade: Number(grade), academicYear: year } });
      setName("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err : undefined);
    } finally {
      setBusy(false);
    }
  }
  const fe = error?.fieldErrors() ?? {};

  return (
    <section aria-labelledby="new-class-h" id="create-class" className="glass" style={{ marginTop: 20 }}>
      <h2 id="new-class-h" style={{ marginTop: 0 }}>
        {t("dashboard.newClass")}
      </h2>
      <form onSubmit={submit} noValidate>
        <div className="grid-3" style={{ maxWidth: "46rem" }}>
          <Field id="cname" label={t("dashboard.className")} error={fe.name}>
            <input className="input" id="cname" value={name} onChange={(e) => setName(e.target.value)} required aria-invalid={fe.name ? true : undefined} />
          </Field>
          <Field id="cgrade" label={t("dashboard.grade")}>
            <select id="cgrade" value={grade} onChange={(e) => setGrade(e.target.value)}>
              {[6, 7, 8, 9, 10].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field id="cyear" label={t("dashboard.academicYear")} error={fe.academicYear}>
            <input className="input" id="cyear" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026-27" required aria-invalid={fe.academicYear ? true : undefined} />
          </Field>
        </div>
        {error && !error.details.length && (
          <Banner tone="err">
            <p>{error.message}</p>
          </Banner>
        )}
        <div className="btn-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? t("common.saving") : t("dashboard.createClass")}
          </button>
        </div>
      </form>
    </section>
  );
}
