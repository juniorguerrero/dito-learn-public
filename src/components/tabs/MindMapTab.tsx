"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Controls, MiniMap, Node, Edge, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MindMapData } from "@/lib/types";
import { GenState } from "../Dashboard";
import TabShell from "../TabShell";

const TYPE_STYLE: Record<string, { bg: string; border: string; color: string; fontSize: number }> = {
  root: { bg: "#7c3aed", border: "#6d28d9", color: "white", fontSize: 15 },
  chapter: { bg: "#ddd6fe", border: "#a78bfa", color: "#4c1d95", fontSize: 13 },
  concept: { bg: "#ffffff", border: "#c4b5fd", color: "#334155", fontSize: 12 },
  detail: { bg: "#f0fdf4", border: "#86efac", color: "#166534", fontSize: 11 },
};

/** Tidy horizontal tree layout: leaves stacked vertically, parents centered on children. */
function layout(data: MindMapData): { nodes: Node[]; edges: Edge[] } {
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  data.edges.forEach((e) => {
    children.set(e.source, [...(children.get(e.source) || []), e.target]);
    hasParent.add(e.target);
  });
  const root = data.nodes.find((n) => n.type === "root") || data.nodes.find((n) => !hasParent.has(n.id)) || data.nodes[0];

  const pos = new Map<string, { x: number; y: number }>();
  let nextLeafY = 0;
  const visited = new Set<string>();

  function place(id: string, depth: number): number {
    if (visited.has(id)) return pos.get(id)?.y ?? 0;
    visited.add(id);
    const kids = (children.get(id) || []).filter((k) => !visited.has(k));
    let y: number;
    if (kids.length === 0) {
      y = nextLeafY;
      nextLeafY += 70;
    } else {
      const ys = kids.map((k) => place(k, depth + 1));
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    pos.set(id, { x: depth * 260, y });
    return y;
  }
  if (root) place(root.id, 0);
  // Any disconnected nodes go in a column at the end
  data.nodes.forEach((n) => {
    if (!pos.has(n.id)) {
      pos.set(n.id, { x: 3 * 260, y: nextLeafY });
      nextLeafY += 70;
    }
  });

  const nodes: Node[] = data.nodes.map((n) => {
    const s = TYPE_STYLE[n.type] || TYPE_STYLE.concept;
    return {
      id: n.id,
      position: pos.get(n.id)!,
      data: { label: n.label },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {
        background: s.bg,
        border: `2px solid ${s.border}`,
        color: s.color,
        fontSize: s.fontSize,
        fontWeight: n.type === "root" || n.type === "chapter" ? 700 : 500,
        borderRadius: 14,
        padding: "8px 14px",
        width: "auto",
        maxWidth: 220,
      },
    };
  });

  const edges: Edge[] = data.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    label: e.label,
    type: "smoothstep",
    animated: false,
    style: { stroke: "#c4b5fd", strokeWidth: 2 },
    labelStyle: { fontSize: 10, fill: "#94a3b8" },
  }));

  return { nodes, edges };
}

export default function MindMapTab({
  data,
  state,
  onGenerate,
}: {
  data?: MindMapData;
  state?: GenState;
  onGenerate: (force?: boolean) => void;
}) {
  const flow = useMemo(() => (data ? layout(data) : null), [data]);

  return (
    <TabShell
      title="Mind Map"
      description="See how every concept connects — chapters, concepts, examples and misconceptions as one visual map."
      emoji="🧠"
      hasData={Boolean(data)}
      state={state}
      onGenerate={onGenerate}
      generateLabel="Generate Mind Map"
      loadingLabel="Mapping your concepts…"
    >
      {flow && (
        <div className="h-[600px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView proOptions={{ hideAttribution: true }}>
            <Background color="#e2e8f0" />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      )}
    </TabShell>
  );
}
