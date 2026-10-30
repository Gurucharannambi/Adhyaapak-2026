# Design system

The UI follows the design delivered in `requirements/adhyaapak-design/` (31 screens, `design-notes.html`). It matches the Adhyaapak landing page: Bricolage Grotesque headlines, IBM Plex Sans text, IBM Plex Mono eyebrows and chips, a Caveat chalk hand for margin notes, pill buttons and 18px cards.

## Where it lives in the app

- `client/src/styles/design.css` is `requirements/adhyaapak-design/styles.css`, copied verbatim apart from font URLs (now `./fonts/…`). Replace it with the newer file when the design changes; do not edit tokens inline in components.
- `client/src/styles/app.css` holds the few additions the React app needs (radio-based option buttons, wrapped-label fields, SVG text colour).
- `client/src/styles/fonts/` holds the local font files (SIL OFL). No external requests, so the app still looks right offline.
- `client/src/assets/classroom-hero.jpg` is the sign-in photo.
- `client/src/components/ui/index.tsx` holds the shared parts: `Icon`, `BrandMark`, `Banner`, `Field`, `FieldError`, `PageHead` (optional eyebrow), `Chip`, `MarginNote`, `StatusMark`/`StatusGlyph`, `EmptyState`.
- `client/src/components/StudentShell.tsx` is the phone-first frame for student screens.

## Palettes

Each screen sets one palette class on `<body>` (`p1`–`p7`); every colour derives from it. `hooks/usePalette.ts` maps teacher routes to palettes (`paletteFor`): lesson p3, activity / class map / branch board p5, paper p6, brief / home note / offline / sync p7, atlas p4, everything else p2. Sign-in and join use p1; other student screens p4. Presentation mode uses `body.chalk` (with `theme-white` for the whiteboard).

Inline SVG (fraction bars, graph) uses `var(--tx)`, `var(--ac)` and `var(--sf)` so it reads on both light and dark palettes.

## Rules carried over from the design

- Status is always a shape plus words (`StatusMark`), never colour alone.
- The chalk hand (`.pen`) is only for explanations and corrections.
- One primary button (`btn-primary`) per screen; destructive actions use `btn-danger`.
- Errors use `Banner tone="err"` or `FieldError`, both announced with `role="alert"`.
- Print layouts use the design's `@media print` rules.

## Known differences from the static HTML

- Wording stays as in `en.json` (tests query by visible text).
- Mono eyebrows above headings are only on the sign-in pages so far; `PageHead` accepts an `eyebrow` for the rest.
- Presentation mode adds a whiteboard toggle; the exit button is labelled "Leave".
- Student answer options are native radio inputs styled as large buttons.

## Landing page

`/` shows the landing page to signed-out visitors (and the dashboard to signed-in teachers). It is a port of `requirements/Landing page-html (1)/Main.dc.html` in `client/src/features/landing/`:

- `LandingPage.tsx` holds the markup and the demo state (concept graph review, worked fraction, mistake follow-up, learning map, paper review). These panels are labelled demo content and use no real student data.
- `landing.css` is generated from the mockup's `<style>` block with every class prefixed `lp-` (so it cannot clash with `design.css`), plus a few overrides. Regenerate it from the mockup if the landing design changes.
- Images are in `client/src/assets/landing/`. Placeholders in the mockup (`[Product name]`, contact e-mail) are replaced by the configured app name and links to register, log in and the student join page.

## Live lesson surfaces

- **Command bar and drawer:** the lesson's sticky bar holds Copilot, Concept map and Projector. The copilot slides in as a drawer (`.rail-drawer`, a `transform` transition), closes on Escape and returns focus to the button. With `prefers-reduced-motion` the slide is instant.
- **Canvas:** fraction bars and circles are SVG with text labels (`aria-label` such as "Bar showing 1 of 2 equal parts shaded"); the spotlight dims the rest rather than hiding it, and meaning never relies on colour alone.
- **Concept map:** status marks pair a shape with words ("Not enough evidence"), so the map reads without colour.
- **Projector:** `large` canvas and the presentation slides carry no student data.

## Studio look (all signed-in teacher pages)

`styles/studio.css` (tokens and component overrides), `studio-today.css` (Today layout) and `studio-fx.css` (sun rays, sticky bar) give every signed-in page one look, modelled on the reference dashboard the product owner supplied: a soft sage-to-lime canvas with faint diagonal light, frosted white panels with large radii, a pill navigation bar, big light numerals, black pill primary buttons, lime for "secure" and sun-yellow for "in progress". It replaces the per-route palettes (p1–p7) for teacher pages; the landing page, sign-in, projector slides and the student phone screens keep their own looks.

Deliberate differences from the reference: no photographs of students (initials only, as these are minors); every chart and count comes from records and says what it counts; "not enough evidence" is drawn hatched so a gap is never read as a weakness; status is always written in words, not colour alone. The reference uses glass and gradients, which CLAUDE.md otherwise discourages; the product owner asked for this look explicitly.
