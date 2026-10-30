import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { useAppConfig } from "../../app/ConfigContext";
import { BrandMark } from "../../components/ui";
import "./landing.css";
import heroImg from "../../assets/landing/hero.jpg";
import syllabusImg from "../../assets/landing/syllabus.jpg";
import visualsImg from "../../assets/landing/visuals.jpg";
import mistakesImg from "../../assets/landing/mistakes.jpg";
import pathsImg from "../../assets/landing/paths.jpg";
import paperImg from "../../assets/landing/paper.jpg";
import commitmentImg from "../../assets/landing/commitment.jpg";

/**
 * Public landing page, ported from requirements/Landing page-html (1)/Main.dc.html.
 * Its CSS is prefixed `lp-` (landing.css) so it never clashes with the app's design.css.
 * The demo panels (concept graph, worked fraction, learning map, paper review) are labelled demo content, not live data.
 */

/** `lp-` class names from a plain list, so the markup reads like the mockup. */
const c = (names: string) =>
  names
    .split(" ")
    .filter(Boolean)
    .map((n) => `lp-${n}`)
    .join(" ");

/** The mockup's inline style strings, as React style objects. */
const st = (css: string): CSSProperties => {
  const out: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const key = prop.startsWith("--") ? prop : prop.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
    out[key] = decl.slice(i + 1).trim();
  }
  return out as CSSProperties;
};

const pad = (n: number) => String(n).padStart(2, "0");

const NAV = ["Classroom", "Syllabus", "Visuals", "Mistakes", "Paths", "Paper", "Commitment"];
const PHASES = ["READING SYLLABUS", "MAPPING CONCEPTS", "SEQUENCING"];

interface GNode {
  id: string;
  name: string;
  col: number;
  pre: string[];
}
const G: GNode[] = [
  { id: "equal", name: "Equal parts of a whole", col: 0, pre: [] },
  { id: "unit", name: "Unit fractions", col: 1, pre: ["equal"] },
  { id: "line", name: "Fractions on a number line", col: 1, pre: ["equal"] },
  { id: "eq", name: "Equivalent fractions", col: 2, pre: ["unit", "line"] },
  { id: "cmp", name: "Comparing fractions", col: 3, pre: ["eq"] },
  { id: "like", name: "Adding like denominators", col: 3, pre: ["unit"] },
  { id: "unlike", name: "Adding unlike denominators", col: 4, pre: ["eq", "like"] },
];

const cells = (n: number, on: number, cls: string) => Array.from({ length: n }, (_, i) => (i < on ? cls : ""));
const SIXTHS = Array.from({ length: 6 }, (_, i) => (i < 3 ? "a" : i < 5 ? "b" : ""));
const FR = [
  {
    say: "Start with what each fraction looks like. Same-sized wholes, different-sized pieces.",
    bars: [
      { label: "½", cells: cells(2, 1, "a"), aria: "One half: 1 of 2 parts shaded" },
      { label: "⅓", cells: cells(3, 1, "b"), aria: "One third: 1 of 3 parts shaded" },
    ],
    lines: [{ t: "½ + ⅓", dim: false }],
  },
  {
    say: "Halves and thirds can't be added directly. Cut both wholes into a size they share: sixths.",
    bars: [
      { label: "3/6", cells: cells(6, 3, "a"), aria: "3 of 6 parts shaded" },
      { label: "2/6", cells: cells(6, 2, "b"), aria: "2 of 6 parts shaded" },
    ],
    lines: [
      { t: "½ + ⅓", dim: true },
      { t: "= 3/6 + 2/6", dim: false },
    ],
  },
  {
    say: "Now the pieces are the same size, so count them together.",
    bars: [{ label: "5/6", cells: SIXTHS, aria: "5 of 6 parts shaded" }],
    lines: [
      { t: "= 3/6 + 2/6", dim: true },
      { t: "= 5/6", dim: false },
    ],
  },
  {
    say: "Check it makes sense: 5/6 is more than ½ and less than one whole. ✓",
    bars: [
      { label: "5/6", cells: SIXTHS, aria: "5 of 6 parts shaded" },
      { label: "1", cells: cells(1, 0, "a"), aria: "One whole, for comparison" },
    ],
    lines: [{ t: "½ < 5/6 < 1", dim: false }],
  },
];

const CN = ["Equal parts of a whole", "Unit fractions", "Equivalent fractions", "Comparing fractions", "Adding like denominators", "Adding unlike denominators"];
const F_T = [8, 14, 30, 26, 18, 46];
const C_T = [46, 34, 18, 22, 30, 10];
const KIDS = Array.from({ length: 24 }, (_, i) => `S${pad(i + 1)}`);
const groupOf = (concept: number, i: number) => {
  const sc = (i * 37 + concept * 23) % 100;
  return sc < F_T[concept]! ? 0 : sc >= 100 - C_T[concept]! ? 2 : 1;
};
const ACT = ["Revisit the prerequisite with paper strips and drawn models.", "Small group with you: one worked example, then paired practice.", "Open problem that stretches the idea, worked independently."];
const GL = ["Foundation practice", "Guided instruction", "Challenge activity"];

const ROWS = [
  { q: "Q1", read: "2/4", res: "Correct", ok: true },
  { q: "Q2", read: "5/6", res: "Correct", ok: true },
  { q: "Q3", read: "2/5", res: "Incorrect", ok: false },
  { q: "Q4", read: "7/8", res: "Correct", ok: true },
];
const PAPER_STEPS = ["Photograph", "Review answers", "Approve evidence"];

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export function LandingPage() {
  const { appName } = useAppConfig();
  const [js, setJs] = useState(false);
  const [active, setActive] = useState(1);
  const [seen, setSeen] = useState<Record<string, boolean>>({ s1: true });
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [gSel, setGSel] = useState("eq");
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({ equal: true, unit: true });
  const [fr, setFr] = useState(0);
  const [ans, setAns] = useState<string | null>(null);
  const [cSel, setCSel] = useState(2);
  const [pp, setPp] = useState(0);
  const [ok3, setOk3] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setJs(true);
    setNow(new Date());
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      setNow(new Date());
    }, 1000);
    const secs = Array.from(root.current?.querySelectorAll("[data-sec]") ?? []);
    let io: IntersectionObserver | undefined;
    let io2: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "undefined") {
      setSeen({ s1: true, s2: true, s3: true, s4: true, s5: true, s6: true, s7: true });
    } else {
      io = new IntersectionObserver(
        (es) => {
          setSeen((prev) => {
            const next = { ...prev };
            for (const e of es) if (e.isIntersecting) next[`s${e.target.getAttribute("data-sec")}`] = true;
            return next;
          });
        },
        { threshold: 0.15 },
      );
      io2 = new IntersectionObserver(
        (es) => {
          for (const e of es) if (e.isIntersecting) setActive(Number(e.target.getAttribute("data-sec")));
        },
        { rootMargin: "-73px 0px -99% 0px", threshold: 0 },
      );
      secs.forEach((s) => {
        io!.observe(s);
        io2!.observe(s);
      });
    }
    return () => {
      clearInterval(timer);
      io?.disconnect();
      io2?.disconnect();
    };
  }, []);

  const clock = now ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` : "--:--:--";
  const phase = PHASES[Math.floor(tick / 2) % 3];
  const lit = Math.floor(tick / 2) % 5;
  const navLinks = NAV.map((label, i) => ({ label, href: `#s${i + 1}`, cur: active === i + 1 }));
  const inClass = (n: number) => (seen[`s${n}`] ? "in" : "");

  const byId = useMemo(() => Object.fromEntries(G.map((n, i) => [n.id, { ...n, lesson: i + 1 }])), []);
  const sel = byId[gSel]!;
  const reviewCount = Object.values(reviewed).filter(Boolean).length;

  const counts = (concept: number) => {
    const cnt = [0, 0, 0];
    KIDS.forEach((_, i) => cnt[groupOf(concept, i)]!++);
    return cnt;
  };
  const curGroups = [0, 1, 2].map((g) => ({ g, kids: KIDS.filter((_, i) => groupOf(cSel, i) === g) }));

  const f = FR[fr]!;
  const diag =
    ans === "half"
      ? { cls: "slip", color: "var(--ok)", tag: "Likely a careless error", head: "They know ½ is bigger, so the size of fractions makes sense to them.", body: "Suggested next step: a quick redo with a reminder to check the answer against ½. No re-teaching needed." }
      : ans === "tf" || ans === "same"
        ? { cls: "mis", color: "var(--ac)", tag: "Possible misconception", head: "They may be treating the top and bottom numbers as separate whole numbers.", body: "Suggested next step: revisit equal-sized pieces with fraction bars before adding again. Flagged for your review." }
        : null;

  return (
    <div ref={root} className={c(`page ${js ? "js" : ""}`)}>
      <a className={c("skip")} href="#s1">
        Skip to content
      </a>

      <header className={c(`nav p${active}`)}>
        <div className={c("wrap nav-in")}>
          <a className={c("logo")} href="#s1" aria-label={`${appName} home`}>
            <span className={c("logo-mark")} style={{ display: "inline-flex" }}>
              <BrandMark />
            </span>
            <span lang="hi">अध्यापक</span>
            <span style={st("font-weight: 500; font-size: 15px; opacity: .7")}>{appName}</span>
          </a>
          <nav aria-label="Sections">
            <ul className={c("links")}>
              {navLinks.map((l) => (
                <li key={l.href}>
                  <a href={l.href} aria-current={l.cur ? "true" : "false"}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className={c("nav-cta")}>
            <Link className={c("btn btn-s btn-sm")} to="/login">
              Log in
            </Link>
            <Link className={c("btn btn-p btn-sm")} to="/register">
              Create an account
            </Link>
          </div>
          <button type="button" className={c("btn btn-s btn-sm menu-btn")} aria-expanded={menuOpen} aria-controls="mpanel" onClick={() => setMenuOpen((o) => !o)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            <span>Menu</span>
          </button>
        </div>
        {menuOpen && (
          <div className={c("mpanel")} id="mpanel">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>
                {l.label}
              </a>
            ))}
            <Link to="/login">Log in</Link>
            <Link to="/register">Create an account</Link>
          </div>
        )}
        <div className={c("prog")} aria-hidden="true" />
      </header>

      <nav className={c(`dots p${active}`)} aria-label="Section progress" style={{ color: "var(--tx)" }}>
        {navLinks.map((l) => (
          <a key={l.href} href={l.href} aria-current={l.cur ? "true" : "false"} aria-label={l.label}>
            <i />
          </a>
        ))}
      </nav>

      <main>
        {/* 01 HERO */}
        <section id="s1" data-sec="1" className={c(`sec p1 ${inClass(1)}`)} aria-labelledby="h-s1">
          <div className={c("wrap hero")}>
            <div style={st("display: flex; flex-direction: column; gap: 28px")}>
              <span className={c("mono eyebrow rv")}>01 · For teachers</span>
              <h1 id="h-s1" className={c("h1 rv d1")}>
                Teaching that <em>adapts</em> to every learner
              </h1>
              <p className={c("lede rv d2")}>
                Start from your syllabus, see how each student is thinking, and plan the next lesson around it. <b>You stay in charge of every decision.</b>
              </p>
              <div className={c("rv d3")} style={st("display: flex; flex-wrap: wrap; gap: 12px")}>
                <a className={c("btn btn-p")} href="#s5">
                  Explore the classroom <ArrowIcon />
                </a>
                <a className={c("btn btn-s")} href="#s2">
                  See how it works
                </a>
              </div>
            </div>
            <div className={c("ph hero-photo rv d2")} role="img" aria-label="Photo: a teacher at the board in a real classroom, with a concept map preview overlaid">
              <img className={c("pimg")} alt="" src={heroImg} style={{ objectPosition: "45% 40%" }} />
              <div className={c("grain")} aria-hidden="true" />
              <div className={c("scan")} aria-hidden="true" />
              <svg className={c("cmap")} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <line x1="20" y1="30" x2="42" y2="52" />
                <line x1="42" y1="52" x2="68" y2="40" />
                <line x1="42" y1="52" x2="56" y2="74" />
                <line x1="68" y1="40" x2="80" y2="64" />
              </svg>
              <span className={c(`node ${lit === 0 ? "on" : ""}`)} style={{ left: "20%", top: "30%" }}>Equal parts</span>
              <span className={c(`node ${lit === 1 ? "on" : ""}`)} style={{ left: "42%", top: "52%" }}>Unit fractions</span>
              <span className={c(`node ${lit === 2 ? "on" : ""}`)} style={{ left: "68%", top: "40%" }}>Equivalent fractions</span>
              <span className={c(`node hide-sm ${lit === 3 ? "on" : ""}`)} style={{ left: "56%", top: "74%" }}>Number line</span>
              <span className={c(`node hide-sm ${lit === 4 ? "on" : ""}`)} style={{ left: "80%", top: "64%" }}>Adding fractions</span>
              <div className={c("hud")} aria-live="polite">
                <div className={c("hud-row")}>
                  <span>
                    <span className={c("dot")} /> LIVE PREVIEW
                  </span>
                  <b>{clock}</b>
                </div>
                <div className={c("hud-row")}>
                  <span>STAGE</span>
                  <b>{phase}</b>
                </div>
                <div className={c("hud-row")}>
                  <span>UNIT</span>
                  <b>FRACTIONS</b>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 02 SYLLABUS */}
        <section id="s2" data-sec="2" className={c(`sec p2 ${inClass(2)}`)} aria-labelledby="h-s2">
          <div className={c("wash")} aria-hidden="true" style={{ background: "linear-gradient(#1d362b, #e4edf5)" }} />
          <div className={c("wrap secpad")} style={st("position: relative; display: flex; flex-direction: column; gap: 48px")}>
            <div className={c("split")}>
              <div style={st("display: flex; flex-direction: column; gap: 22px")}>
                <span className={c("mono eyebrow rv")}>02 · Syllabus to concept graph</span>
                <h2 id="h-s2" className={c("h2 rv d1")}>Start with the syllabus</h2>
                <p className={c("lede rv d2")}>
                  Upload the syllabus you already teach from. It becomes a <b>concept graph with prerequisites and lesson sequences</b>, and nothing is used until you have reviewed it.
                </p>
              </div>
              <div className={c("ph rv d2")} style={st("aspect-ratio: 16 / 9; border-radius: 18px")} role="img" aria-label="Photo: students in a classroom">
                <img className={c("pimg")} alt="" src={syllabusImg} style={{ objectPosition: "50% 35%" }} />
                <div className={c("grain")} aria-hidden="true" />
              </div>
            </div>

            <div style={st("display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 20px; align-items: start")}>
              <div className={c("card syl rv d1")} style={{ gridColumn: "span 1" }}>
                <span className={c("mono")} style={{ color: "var(--mu)" }}>Uploaded · Syllabus excerpt</span>
                <h3 style={{ fontSize: 22 }}>Unit 3 · Fractions</h3>
                <p className={c("syl-line")}>
                  Students understand a fraction as <span className={c("hl")}>equal parts of a whole</span>, recognise <span className={c("hl")}>unit fractions</span> and place fractions on a <span className={c("hl")}>number line</span>.
                </p>
                <p className={c("syl-line")}>
                  They identify <span className={c("hl")}>equivalent fractions</span>, <span className={c("hl")}>compare fractions</span>, and <span className={c("hl")}>add fractions</span> with like and unlike denominators.
                </p>
                <span className={c("mono")} style={{ color: "var(--ac)" }}>7 concepts found · waiting for review</span>
              </div>
              <div className={c("rv d2")} style={{ gridColumn: "span 2", minWidth: 0 }}>
                <div className={c("graph")}>
                  {[0, 1, 2, 3, 4].map((col) => (
                    <div key={col} className={c("gcol")}>
                      {G.filter((n) => n.col === col).map((n) => {
                        const ok = !!reviewed[n.id];
                        const cls = `gnode ${n.id === gSel ? "sel" : ""} ${sel.pre.includes(n.id) ? "pre" : ""} ${ok ? "ok" : ""}`;
                        return (
                          <button key={n.id} type="button" className={c(cls)} aria-pressed={n.id === gSel} onClick={() => setGSel(n.id)}>
                            <span>{n.name}</span>
                            <span className={c("mono")}>{ok ? "✓ Reviewed" : "Needs review"}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className={c("card review")}>
                  <div style={st("display: flex; flex-direction: column; gap: 4px; min-width: 0")}>
                    <span className={c("mono")} style={{ color: "var(--mu)" }}>Selected · Lesson {sel.lesson} of 7</span>
                    <p style={{ fontWeight: 600 }}>{sel.name}</p>
                    <p style={{ fontSize: 15, color: "var(--mu)" }}>{sel.pre.length ? `Builds on: ${sel.pre.map((p) => byId[p]!.name).join(" · ")}` : "No prerequisites. A good place to start."}</p>
                  </div>
                  <div style={st("display: flex; gap: 10px; flex-wrap: wrap")}>
                    <button type="button" className={c("btn btn-p btn-sm")} onClick={() => setReviewed((r) => ({ ...r, [gSel]: true }))}>
                      {reviewed[gSel] ? "Reviewed ✓" : "Approve concept"}
                    </button>
                  </div>
                </div>
                <p className={c("mono")} style={{ marginTop: 12, color: "var(--mu)" }} aria-live="polite">
                  {reviewCount} of 7 concepts teacher-reviewed
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 03 VISUAL EXPLANATIONS */}
        <section id="s3" data-sec="3" className={c(`sec p3 ${inClass(3)}`)} aria-labelledby="h-s3">
          <div className={c("wash")} aria-hidden="true" style={{ background: "linear-gradient(#e4edf5, #2a1c19)" }} />
          <div className={c("wrap secpad")} style={{ position: "relative" }}>
            <div className={c("split")} style={{ alignItems: "center" }}>
              <div style={st("display: flex; flex-direction: column; gap: 22px")}>
                <span className={c("mono eyebrow rv")}>03 · First working example: fractions</span>
                <h2 id="h-s3" className={c("h2 rv d1")}>Explain concepts visually</h2>
                <p className={c("lede rv d2")}>
                  Each concept comes with a <b>visual explanation and a step-by-step worked problem</b>, so students see why the method works, not just what to write.
                </p>
                <div className={c("ph rv d3")} style={st("aspect-ratio: 16 / 10; border-radius: 18px")} role="img" aria-label="Photo: worked maths on a classroom board">
                  <img className={c("pimg")} alt="" src={visualsImg} />
                  <div className={c("grain")} aria-hidden="true" />
                </div>
              </div>
              <div className={c("card board rv d2")}>
                <div style={st("display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center")}>
                  <span className={c("mono")} style={{ color: "#cdb6a4" }}>Worked problem · Step {fr + 1} of 4</span>
                  <span className={c("chalk")} style={{ fontSize: 30, color: "#f2c14e" }}>½ + ⅓ = ?</span>
                </div>
                <p style={{ fontSize: 18, minHeight: 58 }} aria-live="polite">{f.say}</p>
                <div className={c("bars")}>
                  {f.bars.map((b) => (
                    <div key={b.label} className={c("barrow")}>
                      <span className={c("chalk barlab")}>{b.label}</span>
                      <div className={c("bar")} role="img" aria-label={b.aria}>
                        {b.cells.map((cl, i) => (
                          <span key={i} className={c(`cell ${cl}`)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={c("work")}>
                  {f.lines.map((w) => (
                    <span key={w.t} className={c(`chalk eq ${w.dim ? "dim" : ""}`)}>{w.t}</span>
                  ))}
                </div>
                <div style={st("display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center")}>
                  <div className={c("steps")} role="group" aria-label="Steps">
                    {["See it", "Common size", "Add", "Check"].map((label, i) => (
                      <button key={label} type="button" className={c(`step-pill ${i === fr ? "cur" : i < fr ? "done" : ""}`)} aria-current={i === fr ? "step" : "false"} onClick={() => setFr(i)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div style={st("display: flex; gap: 8px")}>
                    <button type="button" className={c("btn btn-s btn-sm")} onClick={() => setFr((x) => Math.max(0, x - 1))} disabled={fr === 0} style={{ color: "#f4e7d9" }}>
                      Back
                    </button>
                    <button type="button" className={c("btn btn-p btn-sm")} onClick={() => setFr((x) => (x === 3 ? 0 : x + 1))}>
                      {fr === 3 ? "Start over" : "Next step"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 04 MISTAKES */}
        <section id="s4" data-sec="4" className={c(`sec p4 ${inClass(4)}`)} aria-labelledby="h-s4">
          <div className={c("wash")} aria-hidden="true" style={{ background: "linear-gradient(#2a1c19, #f7ebe7)" }} />
          <div className={c("wrap secpad")} style={{ position: "relative" }}>
            <div className={c("split")} style={{ alignItems: "center" }}>
              <div className={c("card qcard rv d1")}>
                <div style={st("display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap")}>
                  <span className={c("mono")} style={{ color: "var(--mu)" }}>Student answer · Q4</span>
                  <span className={c("mono")} style={{ color: "var(--ac)" }}>Incorrect</span>
                </div>
                <div className={c("ans")}>
                  <span className={c("strike")}>½ + ⅓ = 2/5</span>
                  <span className={c("ans-x")} aria-hidden="true">✗</span>
                </div>
                <div style={st("display: flex; flex-direction: column; gap: 10px; padding-top: 16px; border-top: 1px solid var(--bd)")}>
                  <span className={c("mono")} style={{ color: "var(--ac)" }}>Follow-up question</span>
                  <p style={{ fontSize: 20, fontWeight: 600 }}>Which is bigger: ½ or 2/5?</p>
                  <p style={{ fontSize: 14, color: "var(--mu)" }}>Try it: choose how the student answers.</p>
                  <div className={c("opts")} role="group" aria-label="Student's follow-up answer">
                    {[
                      { id: "half", label: "½ is bigger" },
                      { id: "tf", label: "2/5 is bigger" },
                      { id: "same", label: "They're the same" },
                    ].map((o) => (
                      <button key={o.id} type="button" className={c(`opt ${ans === o.id ? "sel" : ""}`)} aria-pressed={ans === o.id} onClick={() => setAns(o.id)}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                {diag ? (
                  <div className={c(`diag ${diag.cls}`)} aria-live="polite">
                    <span className={c("mono")} style={{ color: diag.color }}>{diag.tag}</span>
                    <p style={{ fontWeight: 600 }}>{diag.head}</p>
                    <p style={{ fontSize: 15, color: "var(--mu)" }}>{diag.body}</p>
                  </div>
                ) : (
                  <div className={c("diag")} style={{ animation: "none" }}>
                    <span className={c("mono")} style={{ color: "var(--mu)" }}>Waiting for follow-up</span>
                    <p style={{ fontSize: 15, color: "var(--mu)" }}>One wrong answer isn't enough to tell a slip from a misunderstanding.</p>
                  </div>
                )}
              </div>
              <div style={st("display: flex; flex-direction: column; gap: 22px")}>
                <span className={c("mono eyebrow rv")}>04 · Diagnose, don't just mark</span>
                <h2 id="h-s4" className={c("h2 rv d1")}>Understand mistakes</h2>
                <p className={c("lede rv d2")}>
                  An incorrect answer triggers <b>a short follow-up question</b> that helps distinguish a careless error from a possible misconception, so the next step fits the student.
                </p>
                <div className={c("ph rv d3")} style={st("aspect-ratio: 16 / 10; border-radius: 18px")} role="img" aria-label="Photo: a student working at a desk">
                  <img className={c("pimg")} alt="" src={mistakesImg} style={{ objectPosition: "55% 50%" }} />
                  <div className={c("grain")} aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 05 LEARNING PATHS */}
        <section id="s5" data-sec="5" className={c(`sec p5 ${inClass(5)}`)} aria-labelledby="h-s5">
          <div className={c("wash")} aria-hidden="true" style={{ background: "linear-gradient(#f7ebe7, #0e2828)" }} />
          <div className={c("ph band")} aria-hidden="true" style={st("position: absolute; left: 0; right: 0; top: 0; height: 640px; opacity: .5")}>
            <img className={c("pimg")} alt="" src={pathsImg} style={{ objectPosition: "50% 45%" }} />
            <div className={c("grain")} />
          </div>
          <div className={c("wrap secpad")} style={st("position: relative; display: flex; flex-direction: column; gap: 40px")}>
            <div style={st("display: flex; flex-direction: column; gap: 22px; max-width: 760px")}>
              <span className={c("mono eyebrow rv")}>05 · Classroom learning map</span>
              <h2 id="h-s5" className={c("h2 rv d1")}>One classroom, different learning paths</h2>
              <p className={c("lede rv d2")}>
                A learning map shows which concepts need <b>foundation practice</b>, <b>guided instruction</b> or <b>a challenge activity</b>, for the whole class at a glance.
              </p>
            </div>
            <div className={c("card rv d2")} style={st("padding: 22px; display: flex; flex-direction: column; gap: 20px")}>
              <div style={st("display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: center")}>
                <div style={st("display: flex; gap: 12px; align-items: center; flex-wrap: wrap")}>
                  <span className={c("mono")}>Class 5B · Unit 3</span>
                  <span className={c("mono tag-demo")}>Demo data</span>
                </div>
                <div style={st("display: flex; gap: 16px; flex-wrap: wrap; font-size: 14px; color: var(--mu)")}>
                  {["Foundation", "Guided", "Challenge"].map((l, i) => (
                    <span key={l} style={st("display: inline-flex; gap: 8px; align-items: center")}>
                      <i className={c(`sw g${i + 1}`)} />
                      {l}
                    </span>
                  ))}
                </div>
              </div>
              <div className={c("lmap")}>
                <div style={st("display: flex; flex-direction: column; gap: 4px")} role="group" aria-label="Concepts">
                  {CN.map((name, i) => {
                    const cnt = counts(i);
                    return (
                      <button key={name} type="button" className={c(`crow ${i === cSel ? "sel" : ""}`)} aria-pressed={i === cSel} onClick={() => setCSel(i)}>
                        <span>{name}</span>
                        <span className={c("stack")} aria-label={`${cnt[0]} foundation, ${cnt[1]} guided, ${cnt[2]} challenge`}>
                          <i className={c("g1")} style={{ flex: `${cnt[0]} 1 0` }} />
                          <i className={c("g2")} style={{ flex: `${cnt[1]} 1 0` }} />
                          <i className={c("g3")} style={{ flex: `${cnt[2]} 1 0` }} />
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div style={st("display: flex; flex-direction: column; gap: 14px; min-width: 0")}>
                  <p style={{ fontWeight: 600, fontSize: 18 }} aria-live="polite">{CN[cSel]}</p>
                  <div className={c("groups")}>
                    {curGroups.map(({ g, kids }) => (
                      <div key={g} className={c("grp")}>
                        <div className={c("grp-h")}>
                          <i className={c(`sw g${g + 1}`)} />
                          <span style={{ fontWeight: 600 }}>{GL[g]}</span>
                          <span className={c("mono")} style={{ marginLeft: "auto", color: "var(--mu)" }}>{kids.length} students</span>
                        </div>
                        <p style={{ fontSize: 14, color: "var(--mu)" }}>{ACT[g]}</p>
                        <div className={c("chips")}>
                          {kids.map((k) => (
                            <span key={k} className={c("chip")}>{k}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 06 PAPER */}
        <section id="s6" data-sec="6" className={c(`sec p6 ${inClass(6)}`)} aria-labelledby="h-s6">
          <div className={c("wash")} aria-hidden="true" style={{ background: "linear-gradient(#0e2828, #ebebe8)" }} />
          <div className={c("wrap secpad")} style={st("position: relative; display: flex; flex-direction: column; gap: 44px")}>
            <div className={c("split")} style={{ alignItems: "end" }}>
              <div style={st("display: flex; flex-direction: column; gap: 22px")}>
                <span className={c("mono eyebrow rv")}>06 · Paper-first classrooms</span>
                <h2 id="h-s6" className={c("h2 rv d1")}>Turn paper into insight</h2>
                <p className={c("lede rv d2")}>
                  Photograph an assignment, <b>review the extracted answers</b>, and approve them as assessment evidence. Nothing counts until you do.
                </p>
              </div>
              <div className={c("flow rv d2")} role="group" aria-label="Steps">
                <div className={c("fline")} aria-hidden="true">
                  <i style={{ transform: `scaleX(${pp / 2})` }} />
                </div>
                {PAPER_STEPS.map((label, i) => (
                  <button key={label} type="button" className={c(`fstep ${i === pp ? "cur" : i < pp ? "done" : ""}`)} aria-current={i === pp ? "step" : "false"} onClick={() => setPp(i)} style={{ position: "relative", zIndex: 1 }}>
                    <span className={c("fnum")}>{i < pp ? "✓" : String(i + 1)}</span>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={st("display: grid; grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); gap: 20px; align-items: stretch")}>
              <div className={c("ph rv d1")} style={{ borderRadius: 18, minHeight: 360 }} role="img" aria-label="Photo: a completed paper worksheet being photographed">
                <img className={c("pimg")} alt="" src={paperImg} style={{ objectPosition: "40% 50%" }} />
                <div className={c("grain")} aria-hidden="true" />
                {pp === 0 && <div className={c("viewfinder")} aria-hidden="true" />}
              </div>
              <div className={c("card sheet rv d2")}>
                <div style={st("display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center")}>
                  <span className={c("mono")} style={{ color: "var(--mu)" }}>Worksheet · Adding fractions</span>
                  <span className={c("mono tag-demo")}>Demo data</span>
                </div>
                {pp === 0 && (
                  <div style={st("display: flex; flex-direction: column; gap: 14px; padding: 12px 0")}>
                    <p style={{ fontSize: 18, fontWeight: 600 }}>Line up the page and take one photo.</p>
                    <p style={{ color: "var(--mu)" }}>Works with a phone camera. Handwriting stays on paper; only the answers are read.</p>
                    <button type="button" className={c("btn btn-p")} style={{ alignSelf: "flex-start" }} onClick={() => setPp(1)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                        <circle cx="12" cy="13" r="3.5" />
                      </svg>
                      Photograph assignment
                    </button>
                  </div>
                )}
                {pp === 1 && (
                  <div style={st("display: flex; flex-direction: column; gap: 14px")}>
                    <div style={{ overflowX: "auto" }}>
                      <table className={c("tbl")}>
                        <thead>
                          <tr>
                            <th scope="col">Q</th>
                            <th scope="col">Read as</th>
                            <th scope="col">Reading</th>
                            <th scope="col">Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ROWS.map((r) => {
                            const low = r.q === "Q3" && !ok3;
                            return (
                              <tr key={r.q}>
                                <td className={c("mono")} style={{ fontSize: 12 }}>{r.q}</td>
                                <td>
                                  <span className={c("hand")}>{r.read}</span>
                                </td>
                                <td>
                                  {low ? (
                                    <button type="button" className={c("flag low")} style={{ border: 0, cursor: "pointer", minHeight: 32 }} onClick={() => setOk3(true)}>
                                      Check · tap to confirm
                                    </button>
                                  ) : (
                                    <span className={c("flag hi")}>Clear</span>
                                  )}
                                </td>
                                <td style={{ fontWeight: 600, color: r.ok ? "var(--ok, #1f6b4a)" : "var(--ac)" }}>{r.res}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div style={st("display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center")}>
                      <p style={{ fontSize: 14, color: "var(--mu)" }} aria-live="polite">{ok3 ? "All answers checked." : "1 reading needs your check before approval."}</p>
                      <button type="button" className={c("btn btn-p btn-sm")} disabled={!ok3} onClick={() => setPp(2)}>
                        Approve as evidence
                      </button>
                    </div>
                  </div>
                )}
                {pp === 2 && (
                  <div className={c("diag")} style={{ borderColor: "var(--ok, #1f6b4a)", borderStyle: "solid", gap: 12 }}>
                    <span className={c("mono")} style={{ color: "var(--ok, #1f6b4a)" }}>Approved by teacher</span>
                    <p style={{ fontSize: 18, fontWeight: 600 }}>4 answers added to the learning map.</p>
                    <p style={{ color: "var(--mu)", fontSize: 15 }}>Q3 is linked to "Adding unlike denominators" and flagged for a follow-up question.</p>
                    <button
                      type="button"
                      className={c("btn btn-s btn-sm")}
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => {
                        setPp(0);
                        setOk3(false);
                      }}
                    >
                      Start again
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 07 COMMITMENT */}
        <section id="s7" data-sec="7" className={c(`sec p7 ${inClass(7)}`)} aria-labelledby="h-s7">
          <div className={c("wash")} aria-hidden="true" style={{ background: "linear-gradient(#ebebe8, #efe3d4)" }} />
          <div className={c("wrap secpad")} style={st("position: relative; display: flex; flex-direction: column; gap: 44px; padding-bottom: 72px")}>
            <div className={c("ph rv")} style={st("aspect-ratio: 21 / 8; border-radius: 22px")} role="img" aria-label="Photo: children with backpacks walking to school in the morning">
              <img className={c("pimg")} alt="" src={commitmentImg} style={{ objectPosition: "50% 55%" }} />
              <div className={c("grain")} aria-hidden="true" />
            </div>
            <div className={c("split")} style={{ alignItems: "end" }}>
              <div style={st("display: flex; flex-direction: column; gap: 22px")}>
                <span className={c("mono eyebrow rv")}>07 · Our commitment</span>
                <h2 id="h-s7" className={c("h2 rv d1")}>Every learner deserves a way forward</h2>
              </div>
              <div style={st("display: flex; flex-direction: column; gap: 22px")}>
                <p className={c("lede rv d2")}>
                  Built for real classrooms: <b>teacher-led</b>, <b>device-flexible</b>, with <b>printable activities and offline support</b> for schools where connectivity can't be assumed.
                </p>
                <div className={c("rv d3")} style={st("display: flex; flex-wrap: wrap; gap: 12px")}>
                  <Link className={c("btn btn-p")} to="/register">
                    Create a teacher account
                  </Link>
                  <a className={c("btn btn-s")} href="#s2">
                    See how it works
                  </a>
                </div>
              </div>
            </div>
            <div className={c("pillars")}>
              <div className={c("card pillar rv d1")}>
                <span className={c("picon")}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="7" r="3.5" />
                    <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
                  </svg>
                </span>
                <h3 style={{ fontSize: 22 }}>Teacher-led</h3>
                <p style={{ color: "var(--mu)" }}>Concept graphs, groupings and evidence are suggestions until you approve them.</p>
              </div>
              <div className={c("card pillar rv d2")}>
                <span className={c("picon")}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="13" height="10" rx="1.5" />
                    <rect x="15" y="9" width="6" height="11" rx="1.5" />
                    <path d="M7 18h5" />
                  </svg>
                </span>
                <h3 style={{ fontSize: 22 }}>Device-flexible</h3>
                <p style={{ color: "var(--mu)" }}>One teacher phone, a shared laptop, or a device per student. The classroom decides.</p>
              </div>
              <div className={c("card pillar rv d3")}>
                <span className={c("picon")}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 8V3h10v5" />
                    <rect x="3" y="8" width="18" height="9" rx="1.5" />
                    <path d="M7 14h10v7H7z" />
                  </svg>
                </span>
                <h3 style={{ fontSize: 22 }}>Printable &amp; offline</h3>
                <p style={{ color: "var(--mu)" }}>Activities print for paper practice, and lessons keep working without a connection.</p>
              </div>
            </div>
            <footer className={c("foot")}>
              <a className={c("logo")} href="#s1" style={{ color: "var(--tx)" }}>
                <span className={c("logo-mark")} style={{ display: "inline-flex" }}>
                  <BrandMark />
                </span>
                <span>{appName}</span>
              </a>
              <div style={st("display: flex; gap: 20px; flex-wrap: wrap")}>
                <a href="#s2">How it works</a>
                <Link to="/login">Log in</Link>
                <Link to="/join">Students: join a class</Link>
              </div>
              <span>
                © {new Date().getFullYear()} {appName}
              </span>
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}
