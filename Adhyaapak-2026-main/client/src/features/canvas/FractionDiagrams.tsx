import type { Fraction } from "./fraction-model";
import { show } from "./fraction-model";

export type Focus = "none" | "original" | "equivalent" | "match";

const W = 600;

/** A bar cut into `f.d` equal parts, `f.n` shaded. `split` shows each part cut again (for the equivalent bar). */
export function FractionBar({ f, label, dim = false, outline = false }: { f: Fraction; label: string; dim?: boolean; outline?: boolean }) {
  const cell = W / f.d;
  return (
    <svg className={dim ? "fc-diagram is-dim" : "fc-diagram"} viewBox={`0 0 ${W + 4} 64`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      {Array.from({ length: f.d }, (_, i) => (
        <rect key={i} x={2 + i * cell} y={2} width={cell} height={60} className={i < f.n ? "fc-cell is-on" : "fc-cell"} />
      ))}
      {outline && f.n > 0 && <rect x={2} y={2} width={f.n * cell} height={60} className="fc-outline" />}
      <text x={W / 2 + 2} y={39} textAnchor="middle" className="fc-label">
        {show(f)}
      </text>
    </svg>
  );
}

/** The same fraction as a circle of equal slices. Slice 0 starts at the top and they run clockwise. */
export function FractionCircle({ f, label, dim = false, outline = false }: { f: Fraction; label: string; dim?: boolean; outline?: boolean }) {
  const r = 70;
  const cx = 80;
  const cy = 80;
  const pt = (i: number) => {
    const a = (i / f.d) * 2 * Math.PI - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const slice = (i: number) => {
    if (f.d === 1) return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
    const [x1, y1] = pt(i);
    const [x2, y2] = pt(i + 1);
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`;
  };
  const edge = f.n > 0 && f.n < f.d ? pt(f.n) : null;
  return (
    <svg className={dim ? "fc-diagram fc-circle is-dim" : "fc-diagram fc-circle"} viewBox="0 0 160 160" role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      {Array.from({ length: f.d }, (_, i) => (
        <path key={i} d={slice(i)} className={i < f.n ? "fc-cell is-on" : "fc-cell"} />
      ))}
      {outline && edge && <path d={`M ${cx} ${cy - r} A ${r} ${r} 0 ${f.n / f.d > 0.5 ? 1 : 0} 1 ${edge[0]} ${edge[1]} L ${cx} ${cy} Z`} className="fc-outline" />}
      <text x={cx} y={cy + 6} textAnchor="middle" className="fc-label fc-label-circle">
        {show(f)}
      </text>
    </svg>
  );
}
