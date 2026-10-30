interface Props {
  /** Number of equal parts in the whole. */
  parts: number;
  /** Number of parts shaded. */
  shaded: number;
  /** If set, each part is drawn cut into this many smaller equal parts (to show equivalent fractions). */
  splitInto?: number;
  /** Bigger drawing for the projector. */
  large?: boolean;
}

/**
 * First manipulative (standout feature 4). A plain SVG so it also prints.
 * Shading is shown with a pattern fill and a text label, never colour alone.
 */
export function FractionBar({ parts, shaded, splitInto = 1, large = false }: Props) {
  const total = parts * splitInto;
  const shadedCells = shaded * splitInto;
  const width = 360;
  const cell = width / total;
  const label = `${shaded} of ${parts} equal parts shaded${splitInto > 1 ? `, each part cut into ${splitInto}` : ""}`;

  return (
    <figure style={{ margin: "0.5rem 0" }}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${width} 44`} width="100%" style={{ maxWidth: large ? 760 : 420 }}>
        <defs>
          <pattern id="shade" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--ac-t)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ac)" strokeWidth="2" />
          </pattern>
        </defs>
        {Array.from({ length: total }, (_, i) => (
          <rect key={i} x={i * cell} y={2} width={cell} height={40} fill={i < shadedCells ? "url(#shade)" : "var(--sf)"} stroke="var(--tx)" strokeWidth={i % splitInto === 0 ? 2 : 0.75} />
        ))}
      </svg>
      <figcaption>
        <small>
          {shaded}/{parts}
          {splitInto > 1 ? ` = ${shadedCells}/${total}` : ""}
        </small>
      </figcaption>
    </figure>
  );
}
