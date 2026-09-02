import { useEffect, useRef } from "react";
import { sort } from "remeda";
import { drag, type D3DragEvent } from "d3-drag";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { scaleSqrt } from "d3-scale";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type D3ZoomEvent } from "d3-zoom";

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  inboundLinkCount: number;
  pagerank: number;
  isOrphan: boolean;
  /** Topical cluster from the audit, or null when themes were not computed. */
  themeId: number | null;
  themeLabel: string | null;
}

export interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  /** "internal" is a link the crawl actually found; the others are findings. */
  kind: "internal" | "broken" | "suggested";
  score?: number;
}

/**
 * "links" lays the graph out on its link forces alone — the real shape of the
 * internal linking. "topics" adds a pull towards each cluster's centre, which
 * separates the subjects at the cost of distorting that shape.
 */
export type GraphLayout = "links" | "topics";

const NODE_RADIUS_RANGE: [number, number] = [6, 24];
const CHARGE_STRENGTH = -260;
/**
 * Okabe-Ito, which stays distinguishable for the common forms of colour
 * blindness — a categorical scheme has to survive being the only thing that
 * separates two groups.
 */
const THEME_COLORS = [
  "#0072b2",
  "#e69f00",
  "#009e73",
  "#cc79a7",
  "#56b4e9",
  "#d55e00",
  "#f0e442",
  "#8c6bb1",
  "#1b9e77",
  "#a6761d",
] as const;
const UNTHEMED_COLOR = "#7a8394";
/** Pull towards the cluster's centre of mass; gentle enough that link forces still shape the layout. */
const CLUSTER_STRENGTH = 0.12;
/** Below this zoom only the most linked pages are named, or labels overlap into mush. */
const LABEL_ZOOM_THRESHOLD = 1.4;
/** How many pages keep a permanent label at overview zoom. */
const ALWAYS_LABELLED = 12;
const LABEL_MAX_CHARS = 28;

/** Shared with the legend so a swatch always matches its nodes. */
export function themeColorForId(themeId: number | null): string {
  if (themeId == null) return UNTHEMED_COLOR;
  return THEME_COLORS[themeId % THEME_COLORS.length];
}

function themeColor(node: GraphNode): string {
  return themeColorForId(node.themeId);
}

function truncate(text: string): string {
  return text.length > LABEL_MAX_CHARS
    ? `${text.slice(0, LABEL_MAX_CHARS - 1)}…`
    : text;
}

/**
 * Attracts each node towards its cluster's centre of mass, so pages on the
 * same subject settle together instead of being scattered by the link force
 * alone. Centres are recomputed every tick from the nodes themselves, so no
 * fixed positions have to be invented for clusters.
 */
function forceCluster(nodes: GraphNode[], strength: number) {
  return (alpha: number) => {
    const sums = new Map<number, { x: number; y: number; count: number }>();
    for (const node of nodes) {
      if (node.themeId == null) continue;
      const entry = sums.get(node.themeId) ?? { x: 0, y: 0, count: 0 };
      entry.x += node.x ?? 0;
      entry.y += node.y ?? 0;
      entry.count += 1;
      sums.set(node.themeId, entry);
    }

    for (const node of nodes) {
      if (node.themeId == null) continue;
      const centre = sums.get(node.themeId);
      if (!centre || centre.count === 0) continue;
      const pull = strength * alpha;
      node.vx =
        (node.vx ?? 0) + (centre.x / centre.count - (node.x ?? 0)) * pull;
      node.vy =
        (node.vy ?? 0) + (centre.y / centre.count - (node.y ?? 0)) * pull;
    }
  };
}

/** After the link force resolves ids to node objects; still a string/number before that happens. */
function resolvedNode(
  endpoint: string | number | GraphNode | undefined,
): GraphNode | undefined {
  return typeof endpoint === "object" ? endpoint : undefined;
}

export function InternalLinkingGraph({
  nodes,
  edges,
  layout,
  onNodeClick,
  onNodeHide,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: GraphLayout;
  onNodeClick: (node: GraphNode) => void;
  /** Right-click hides a node, to clear the view around what is being read. */
  onNodeHide: (node: GraphNode) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const svgEl = svgRef.current;
    const container = containerRef.current;
    if (!svgEl || !container || nodes.length === 0) return;

    const width = container.clientWidth || 800;
    const height = 560;

    // Simulation mutates these in place; work on copies so React's own
    // `nodes`/`edges` props stay untouched across re-renders.
    const simNodes: GraphNode[] = nodes.map((node) => ({ ...node }));
    const simEdges: GraphEdge[] = edges.map((edge) => ({ ...edge }));

    const maxInbound = Math.max(1, ...simNodes.map((n) => n.inboundLinkCount));
    const radiusScale = scaleSqrt()
      .domain([0, maxInbound])
      .range(NODE_RADIUS_RANGE);

    const svg = select(svgEl)
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("height", height);
    svg.selectAll("*").remove();

    const root = svg.append("g");

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        root.attr("transform", event.transform.toString());
        // Every label at once is unreadable on a large site, so the long tail
        // is revealed only once the view is zoomed in far enough to fit them.
        const showAll = event.transform.k >= LABEL_ZOOM_THRESHOLD;
        labelSelection.attr("opacity", (d) =>
          showAll || alwaysLabelled.has(d.id) ? 1 : 0,
        );
        // Keep text legible at any zoom instead of scaling with the graph.
        labelSelection.attr("font-size", 10 / Math.sqrt(event.transform.k));
      });
    svg.call(zoomBehavior);

    const linkSelection = root
      .append("g")
      .attr("fill", "none")
      .selectAll("line")
      .data(simEdges)
      .join("line")
      // Real links are the substance and there are thousands of them, so they
      // stay thin and quiet; findings are few and must stand out against them.
      .attr("class", (d) =>
        d.kind === "broken"
          ? "stroke-error/70"
          : d.kind === "suggested"
            ? "stroke-info/60"
            : "stroke-base-content/25",
      )
      .attr("stroke-width", (d) => (d.kind === "internal" ? 0.6 : 1.5))
      .attr("stroke-dasharray", (d) => (d.kind === "internal" ? null : "4 3"));

    const dragBehavior = drag<SVGCircleElement, GraphNode>()
      .on(
        "start",
        (event: D3DragEvent<SVGCircleElement, GraphNode, GraphNode>, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        },
      )
      .on(
        "drag",
        (event: D3DragEvent<SVGCircleElement, GraphNode, GraphNode>, d) => {
          d.fx = event.x;
          d.fy = event.y;
        },
      )
      .on(
        "end",
        (event: D3DragEvent<SVGCircleElement, GraphNode, GraphNode>, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        },
      );

    const nodeSelection = root
      .append("g")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(simNodes)
      .join("circle")
      .attr("r", (d) => radiusScale(d.inboundLinkCount))
      .attr("class", "cursor-pointer")
      .attr("fill", (d) => themeColor(d))
      .attr("fill-opacity", 0.75)
      // Orphans keep a distinct outline: colour now carries the topic, so
      // "no inbound links" needs its own channel to stay visible.
      .attr("stroke", (d) => (d.isOrphan ? "#d55e00" : themeColor(d)))
      .attr("stroke-width", (d) => (d.isOrphan ? 2.5 : 1.5))
      .attr("stroke-dasharray", (d) => (d.isOrphan ? "3 2" : null))
      .on("click", (_event, d) => onNodeClick(d))
      .on("contextmenu", (event: MouseEvent, d) => {
        // Suppress the browser menu: the gesture belongs to the graph here.
        event.preventDefault();
        onNodeHide(d);
      })
      .call(dragBehavior);

    nodeSelection
      .append("title")
      .text((d) =>
        [d.title, d.id, d.themeLabel ? `Theme: ${d.themeLabel}` : null]
          .filter(Boolean)
          .join("\n"),
      );

    // Labels live in their own layer so they always paint above the nodes.
    const rankedByLinks = sort(
      simNodes,
      (a, b) => b.inboundLinkCount - a.inboundLinkCount,
    );
    const alwaysLabelled = new Set(
      rankedByLinks.slice(0, ALWAYS_LABELLED).map((node) => node.id),
    );

    const labelSelection = root
      .append("g")
      .attr("pointer-events", "none")
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(simNodes)
      .join("text")
      .text((d) => truncate(d.title))
      .attr("font-size", 10)
      .attr("text-anchor", "middle")
      .attr("class", "fill-base-content")
      .attr("paint-order", "stroke")
      .attr("stroke", "var(--fallback-b1,oklch(var(--b1)))")
      .attr("stroke-width", 3)
      .attr("stroke-linejoin", "round")
      .attr("opacity", (d) => (alwaysLabelled.has(d.id) ? 1 : 0));

    // Only now that labelSelection exists: the zoom handler reads it, and
    // transform() dispatches a zoom event synchronously.
    zoomBehavior.transform(svg, zoomIdentity);

    const simulation = forceSimulation(simNodes)
      .force(
        "link",
        forceLink<GraphNode, GraphEdge>(simEdges)
          .id((d) => d.id)
          .distance(90),
      )
      .force("charge", forceManyBody().strength(CHARGE_STRENGTH))
      .force("center", forceCenter(width / 2, height / 2))
      .force(
        "collide",
        forceCollide<GraphNode>((d) => radiusScale(d.inboundLinkCount) + 8),
      );

    if (layout === "topics" && simNodes.some((node) => node.themeId != null)) {
      simulation.force("cluster", forceCluster(simNodes, CLUSTER_STRENGTH));
    }

    simulation.on("tick", () => {
      linkSelection
        .attr("x1", (d) => resolvedNode(d.source)?.x ?? 0)
        .attr("y1", (d) => resolvedNode(d.source)?.y ?? 0)
        .attr("x2", (d) => resolvedNode(d.target)?.x ?? 0)
        .attr("y2", (d) => resolvedNode(d.target)?.y ?? 0);
      nodeSelection.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
      labelSelection
        .attr("x", (d) => d.x ?? 0)
        .attr("y", (d) => (d.y ?? 0) - radiusScale(d.inboundLinkCount) - 4);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, layout, onNodeClick, onNodeHide]);

  if (nodes.length === 0) {
    return (
      <p className="text-sm text-base-content/60 py-8 text-center">
        No pages to visualize.
      </p>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <svg
        ref={svgRef}
        className="rounded-lg border border-base-300 bg-base-100"
      />
    </div>
  );
}
