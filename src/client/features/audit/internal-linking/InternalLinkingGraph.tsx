import { useEffect, useRef } from "react";
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
}

export interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  kind: "broken" | "suggested";
  score?: number;
}

const NODE_RADIUS_RANGE: [number, number] = [6, 24];
const CHARGE_STRENGTH = -260;

/** After the link force resolves ids to node objects; still a string/number before that happens. */
function resolvedNode(
  endpoint: string | number | GraphNode | undefined,
): GraphNode | undefined {
  return typeof endpoint === "object" ? endpoint : undefined;
}

export function InternalLinkingGraph({
  nodes,
  edges,
  onNodeClick,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick: (node: GraphNode) => void;
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
      });
    svg.call(zoomBehavior);
    zoomBehavior.transform(svg, zoomIdentity);

    const linkSelection = root
      .append("g")
      .attr("fill", "none")
      .selectAll("line")
      .data(simEdges)
      .join("line")
      .attr("class", (d) =>
        d.kind === "broken" ? "stroke-error/70" : "stroke-info/60",
      )
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "4 3");

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
      .attr("class", (d) =>
        d.isOrphan
          ? "fill-warning/70 stroke-warning cursor-pointer"
          : "fill-primary/70 stroke-primary cursor-pointer",
      )
      .attr("stroke-width", 1.5)
      .on("click", (_event, d) => onNodeClick(d))
      .call(dragBehavior);

    nodeSelection.append("title").text((d) => `${d.title}\n${d.id}`);

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

    simulation.on("tick", () => {
      linkSelection
        .attr("x1", (d) => resolvedNode(d.source)?.x ?? 0)
        .attr("y1", (d) => resolvedNode(d.source)?.y ?? 0)
        .attr("x2", (d) => resolvedNode(d.target)?.x ?? 0)
        .attr("y2", (d) => resolvedNode(d.target)?.y ?? 0);
      nodeSelection.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, onNodeClick]);

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
