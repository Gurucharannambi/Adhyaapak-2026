import { useBodyClass } from "./useBodyClass";

/** The design gives each screen one palette (p1 to p7) set on <body>; see docs/DESIGN.md. */
export type Palette = "p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7";

/** Which palette a teacher route uses: lesson p3, live class screens p5, paper p6, briefs and offline p7, the rest p2. */
export function paletteFor(pathname: string): Palette {
  if (/\/lessons\//.test(pathname)) return "p3";
  if (/\/(map|concept-map|branch-board)$/.test(pathname) || /^\/activities\/[^/]+$/.test(pathname)) return "p5";
  if (/\/paper|\/print-sheets/.test(pathname)) return "p6";
  if (/\/(brief|home-note)$/.test(pathname) || /^\/(offline|sync)/.test(pathname)) return "p7";
  if (pathname === "/atlas") return "p4";
  return "p2";
}

/** Working screens (lesson flow, class map, branch board, activity) use the wide page so large displays are not left empty. */
export function isWideRoute(pathname: string): boolean {
  return /\/lessons\/|\/(map|concept-map|branch-board)$|^\/activities\/|^\/classes\/[^/]+\/timetable$/.test(pathname);
}

export function usePalette(p: Palette) {
  useBodyClass(p);
}
