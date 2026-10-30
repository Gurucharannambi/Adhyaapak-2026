import { FractionBar } from "./FractionBar";

interface Mark {
  at: number;
  label: string;
}

/**
 * The reusable manipulatives (standout feature 4). Plain SVG, so they also print. Each has a text
 * description for screen readers, and shading uses patterns plus labels, never colour alone.
 */
export function Manipulative({ spec, large = false }: { spec: Record<string, unknown> | null | undefined; large?: boolean }) {
  if (!spec) return null;
  switch (spec.type) {
    case "fraction-bar": {
      const cmp = spec.compareWith as { parts: number; shaded: number } | undefined;
      return (
        <div>
          <FractionBar parts={Number(spec.parts)} shaded={Number(spec.shaded)} {...(spec.splitInto ? { splitInto: Number(spec.splitInto) } : {})} large={large} />
          {cmp && <FractionBar parts={cmp.parts} shaded={cmp.shaded} large={large} />}
        </div>
      );
    }
    case "number-line":
      return <NumberLine divisions={Number(spec.divisions) || 10} marks={Array.isArray(spec.marks) ? (spec.marks as Mark[]) : []} large={large} />;
    case "area-model":
      return <AreaModel rows={Number(spec.rows)} cols={Number(spec.cols)} large={large} />;
    default:
      return null;
  }
}

/** A number line from 0 to 1 with equal divisions and labelled marks. */
export function NumberLine({ divisions, marks, large }: { divisions: number; marks: Mark[]; large?: boolean }) {
  const w = 420;
  const pad = 16;
  const x = (v: number) => pad + v * (w - 2 * pad);
  const label = `A number line from 0 to 1 split into ${divisions} equal parts. ${marks.map((m) => `${m.label} is marked`).join(". ")}`;
  return (
    <figure style={{ margin: "0.5rem 0" }}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${w} 86`} width="100%" style={{ maxWidth: large ? 760 : 460 }}>
        <line x1={x(0)} y1={40} x2={x(1)} y2={40} stroke="var(--tx)" strokeWidth={2} />
        {Array.from({ length: divisions + 1 }, (_, i) => (
          <line key={i} x1={x(i / divisions)} y1={34} x2={x(i / divisions)} y2={46} stroke="var(--mu)" strokeWidth={i % divisions === 0 ? 2 : 1} />
        ))}
        <text x={x(0)} y={64} textAnchor="middle" fontSize="13">
          0
        </text>
        <text x={x(1)} y={64} textAnchor="middle" fontSize="13">
          1
        </text>
        {marks.map((m, i) => (
          <g key={m.label}>
            <circle cx={x(m.at)} cy={40} r={6} fill="var(--sf)" stroke="var(--ac)" strokeWidth={3} />
            <text x={x(m.at)} y={i % 2 === 0 ? 20 : 80} textAnchor="middle" fontSize="13" fontWeight="bold">
              {m.label}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

/** A rows × columns grid showing multiplication as equal groups. */
export function AreaModel({ rows, cols, large }: { rows: number; cols: number; large?: boolean }) {
  const cell = 28;
  const w = cols * cell + 4;
  const h = rows * cell + 4;
  return (
    <figure style={{ margin: "0.5rem 0" }}>
      <svg role="img" aria-label={`${rows} rows of ${cols} equal squares, ${rows * cols} squares in all`} viewBox={`0 0 ${w} ${h}`} width={large ? w * 3 : w} style={{ maxWidth: "100%" }}>
        {Array.from({ length: rows * cols }, (_, i) => (
          <rect key={i} x={2 + (i % cols) * cell} y={2 + Math.floor(i / cols) * cell} width={cell} height={cell} fill="var(--ac-t)" stroke="var(--tx)" strokeWidth={1.5} />
        ))}
      </svg>
      <figcaption>
        {rows} × {cols} = {rows * cols}
      </figcaption>
    </figure>
  );
}
