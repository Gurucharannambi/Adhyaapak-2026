import type { ProposalDto } from "@adhyaapak/shared";
import { layoutGraph } from "./layout";

const W = 168;
const H = 46;
const GX = 56;
const GY = 18;

/**
 * The concept graph, drawn left to right in teaching order. Plain SVG (it prints). Accepted
 * prerequisites are solid, undecided ones dashed with a "?"; rejected ones are not drawn. The list of
 * prerequisites below the picture says the same thing in words, so nothing depends on seeing the lines.
 */
export function GraphView({ concepts, edges, label }: { concepts: ProposalDto["concepts"]; edges: ProposalDto["edges"]; label: string }) {
  const nodes = layoutGraph(concepts, edges);
  if (nodes.length === 0) return null;
  const at = new Map(nodes.map((n) => [n.id, n]));
  const cols = Math.max(...nodes.map((n) => n.depth)) + 1;
  const rows = Math.max(...nodes.map((n) => n.row)) + 1;
  const width = cols * W + (cols - 1) * GX + 4;
  const height = rows * H + (rows - 1) * GY + 4;
  const x = (n: { depth: number }) => 2 + n.depth * (W + GX);
  const y = (n: { row: number }) => 2 + n.row * (H + GY);

  return (
    <div className="table-wrap">
      <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ maxWidth: "none" }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--tx)" />
          </marker>
        </defs>
        {edges
          .filter((e) => e.decision !== "rejected")
          .map((e) => {
            const a = at.get(e.prerequisiteConceptId);
            const b = at.get(e.dependentConceptId);
            if (!a || !b) return null;
            const x1 = x(a) + W;
            const y1 = y(a) + H / 2;
            const x2 = x(b);
            const y2 = y(b) + H / 2;
            const mx = (x1 + x2) / 2;
            const pending = e.decision === "pending";
            return (
              <g key={e.id}>
                <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 - 2} ${y2}`} fill="none" stroke="var(--tx)" strokeWidth={pending ? 1.5 : 2} strokeDasharray={pending ? "5 4" : undefined} markerEnd="url(#arrow)" />
                {pending && (
                  <text x={mx} y={(y1 + y2) / 2 - 4} textAnchor="middle" fontSize="22" fill="var(--ac)" style={{ fontFamily: "var(--f-pen)" }}>
                    ?
                  </text>
                )}
              </g>
            );
          })}
        {concepts.map((c) => {
          const n = at.get(c.id)!;
          return (
            <g key={c.id}>
              <rect x={x(n)} y={y(n)} width={W} height={H} rx={3} fill={c.grounded ? "var(--ac-t)" : "var(--sf)"} stroke="var(--tx)" strokeWidth={2} strokeDasharray={c.grounded ? undefined : "4 3"} />
              <title>{c.title}</title>
              <text x={x(n) + W / 2} y={y(n) + H / 2 + 4} textAnchor="middle" fontSize="12">
                {c.title.length > 24 ? `${c.title.slice(0, 23)}…` : c.title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
