/**
 * The d3 layer of the internal-linking graph: forces, painting, zoom and
 * emphasis. Kept out of the React component because none of it belongs to
 * React's render cycle — hovering a node or selecting one must repaint
 * without re-running the simulation.
 */
import { sort } from "remeda";
import { drag, type D3DragEvent } from "d3-drag";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force";
import { scaleSqrt } from "d3-scale";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type D3ZoomEvent } from "d3-zoom";
import {
  themeColorForId,
  type GraphEdge,
  type GraphLayout,
  type GraphNode,
} from "@/client/features/audit/internal-linking/graph-model";
import {
  forceCluster,
  CLUSTER_STRENGTH,
} from "@/client/features/audit/internal-linking/graph-forces";

const NODE_RADIUS_RANGE: [number, number] = [6, 24];
const CHARGE_STRENGTH = -260;
/** Link forces are damped in "topics" so they position within a cluster rather than across. */
const TOPIC_LINK_STRENGTH = 0.02;
/** Below this zoom only the most linked pages are named, or labels overlap into mush. */
const LABEL_ZOOM_THRESHOLD = 1.4;
/** How many pages keep a permanent label at overview zoom. */
const ALWAYS_LABELLED = 12;
const LABEL_MAX_CHARS = 28;
export const ZOOM_EXTENT: [number, number] = [0.05, 8];
/** Fit leaves this much of the viewport as margin around the graph. */
const FIT_PADDING = 0.9;
/** A click this soon after a pan is that pan's mouse-up, not a click. */
const PAN_CLICK_MS = 150;

/** What the React shell can ask of a rendered graph. */
export interface GraphControls {
  zoomBy: (factor: number) => void;
  fit: () => void;
  emphasize: (
    focusId: string | null,
    matches: ReadonlySet<string> | null,
  ) => void;
  destroy: () => void;
}

export interface RenderGraphOptions {
  svgEl: SVGSVGElement;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: GraphLayout;
  width: number;
  height: number;
  /** Unique per component instance, so two graphs don't share a marker. */
  arrowId: string;
  focusId: string | null;
  matches: ReadonlySet<string> | null;
  onNodeClick: (node: GraphNode) => void;
  onNodeHide: (node: GraphNode) => void;
  onClearSelection: () => void;
}

function truncate(text: string): string {
  return text.length > LABEL_MAX_CHARS
    ? `${text.slice(0, LABEL_MAX_CHARS - 1)}…`
    : text;
}

function endpointId(endpoint: string | number | GraphNode | undefined): string {
  return typeof endpoint === "object" ? endpoint.id : String(endpoint ?? "");
}

/** After the link force resolves ids to node objects; still a string/number before that happens. */
function resolvedNode(
  endpoint: string | number | GraphNode | undefined,
): GraphNode | undefined {
  return typeof endpoint === "object" ? endpoint : undefined;
}

/** Both directions, so selecting a page lights up what links to it too. */
function buildAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const neighbours = new Map<string, Set<string>>();
  const connect = (from: string, to: string) => {
    const known = neighbours.get(from);
    if (known) known.add(to);
    else neighbours.set(from, new Set([to]));
  };
  for (const edge of edges) {
    const source = endpointId(edge.source);
    const target = endpointId(edge.target);
    connect(source, target);
    connect(target, source);
  }
  return neighbours;
}

function baseEdgeClass(kind: GraphEdge["kind"]): string {
  if (kind === "broken") return "stroke-error/70";
  if (kind === "suggested") return "stroke-info/60";
  // Real links are the substance and there are thousands of them, so they stay
  // thin and quiet; template links quieter still, findings must stand out.
  if (kind === "template") return "stroke-base-content/10";
  return "stroke-base-content/25";
}

function baseEdgeWidth(kind: GraphEdge["kind"]): number {
  return kind === "body" || kind === "template" ? 0.6 : 1.4;
}

export function renderGraph(options: RenderGraphOptions): GraphControls {
  const { svgEl, layout, width, height, arrowId } = options;

  // The simulation mutates nodes and edges in place; work on copies so the
  // caller's React state stays untouched across re-renders.
  const simNodes: GraphNode[] = options.nodes.map((node) => ({ ...node }));
  const simEdges: GraphEdge[] = options.edges.map((edge) => ({ ...edge }));
  // Built before forceLink swaps the endpoint ids for node objects.
  const neighbours = buildAdjacency(simEdges);

  const maxInbound = Math.max(1, ...simNodes.map((n) => n.inboundLinkCount));
  const radiusScale = scaleSqrt()
    .domain([0, maxInbound])
    .range(NODE_RADIUS_RANGE);

  const svg = select(svgEl)
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("height", "100%");
  svg.selectAll("*").remove();

  // Direction only matters once a page is in focus; arrowheads on thousands
  // of quiet links would cost paint time and read as noise.
  svg
    .append("defs")
    .append("marker")
    .attr("id", arrowId)
    .attr("viewBox", "0 -4 8 8")
    .attr("refX", 8)
    .attr("markerWidth", 5)
    .attr("markerHeight", 5)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-4L8,0L0,4")
    .attr("class", "fill-current");

  const root = svg.append("g");

  const linkSelection = root
    .append("g")
    .attr("fill", "none")
    .selectAll("line")
    .data(simEdges)
    .join("line")
    .attr("stroke-dasharray", (d) =>
      d.kind === "broken" || d.kind === "suggested" ? "4 3" : null,
    );

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
    .attr("fill", (d) => themeColorForId(d.themeId))
    // Orphans keep a distinct outline: colour now carries the topic, so
    // "no inbound links" needs its own channel to stay visible.
    .attr("stroke", (d) =>
      d.isOrphan ? "#d55e00" : themeColorForId(d.themeId),
    )
    .attr("stroke-width", (d) => (d.isOrphan ? 2.5 : 1.5))
    .attr("stroke-dasharray", (d) => (d.isOrphan ? "3 2" : null))
    .on("click", (event: MouseEvent, d) => {
      event.stopPropagation();
      options.onNodeClick(d);
    })
    .on("contextmenu", (event: MouseEvent, d) => {
      // Suppress the browser menu: the gesture belongs to the graph here.
      event.preventDefault();
      options.onNodeHide(d);
    })
    .on("mouseenter", (_event, d) => applyEmphasis(d.id))
    .on("mouseleave", () => applyEmphasis(null))
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
    .attr("text-anchor", "middle")
    .attr("class", "fill-base-content")
    .attr("paint-order", "stroke")
    .attr("stroke", "var(--fallback-b1,oklch(var(--b1)))")
    .attr("stroke-width", 3)
    .attr("stroke-linejoin", "round");

  // Emphasis state lives outside React: hovering must not re-render the
  // component, and selecting must not restart the simulation.
  let focusId = options.focusId;
  let hoverId: string | null = null;
  let matches = options.matches;
  let zoomLevel = 1;

  const dimmedBySearch = (id: string) => matches !== null && !matches.has(id);

  function applyLabels(lit: Set<string> | null) {
    // Every label at once is unreadable on a large site, so the long tail is
    // revealed only once the view is zoomed in far enough to fit them.
    const showAll = zoomLevel >= LABEL_ZOOM_THRESHOLD;
    labelSelection
      .attr("opacity", (d) => {
        if (lit) return lit.has(d.id) ? 1 : 0;
        if (dimmedBySearch(d.id)) return 0;
        if (matches !== null) return 1;
        return showAll || alwaysLabelled.has(d.id) ? 1 : 0;
      })
      // Keep text legible at any zoom instead of scaling with the graph.
      .attr("font-size", 10 / Math.sqrt(zoomLevel));
  }

  function applyEmphasis(nextHoverId?: string | null) {
    if (nextHoverId !== undefined) hoverId = nextHoverId;
    const focus = hoverId ?? focusId;
    const lit = focus
      ? new Set([focus, ...(neighbours.get(focus) ?? [])])
      : null;

    nodeSelection
      .attr("fill-opacity", (d) => {
        if (dimmedBySearch(d.id)) return 0.05;
        if (!lit) return 0.75;
        return lit.has(d.id) ? 0.95 : 0.06;
      })
      .attr("stroke-opacity", (d) => {
        if (dimmedBySearch(d.id)) return 0.1;
        if (!lit) return 1;
        return lit.has(d.id) ? 1 : 0.1;
      });

    linkSelection
      .attr("class", (d) => {
        const source = endpointId(d.source);
        const target = endpointId(d.target);
        // Direction is the whole question when reading one page: what it
        // links out to versus what sends it authority.
        if (focus && source === focus) return "stroke-primary";
        if (focus && target === focus) return "stroke-secondary";
        return baseEdgeClass(d.kind);
      })
      .attr("stroke-opacity", (d) => {
        const source = endpointId(d.source);
        const target = endpointId(d.target);
        const touchesFocus =
          focus !== null && (source === focus || target === focus);
        if (focus) return touchesFocus ? 1 : 0.04;
        if (matches !== null) {
          return matches.has(source) && matches.has(target) ? 1 : 0.04;
        }
        return 1;
      })
      .attr("stroke-width", (d) => {
        const touchesFocus =
          focus !== null &&
          (endpointId(d.source) === focus || endpointId(d.target) === focus);
        return touchesFocus ? 1.8 : baseEdgeWidth(d.kind);
      })
      .attr("marker-end", (d) =>
        focus !== null && endpointId(d.source) === focus
          ? `url(#${arrowId})`
          : null,
      );

    applyLabels(lit);
  }

  // Set by the reader's own zoom or pan, never by fit() — once they have
  // framed the graph themselves, the settling simulation must not re-frame it.
  let viewportIsTheirs = false;
  let lastGestureAt = 0;

  const zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent(ZOOM_EXTENT)
    .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
      root.attr("transform", event.transform.toString());
      zoomLevel = event.transform.k;
      if (event.sourceEvent) {
        viewportIsTheirs = true;
        lastGestureAt = Date.now();
      }
      applyLabels(null);
      if (focusId || hoverId) applyEmphasis();
    });
  svg.call(zoomBehavior);
  // Clicking the background is how a reader lets go of a page — but releasing
  // a pan also lands a click on it, and that must not clear the selection.
  svg.on("click", (event: MouseEvent) => {
    if (event.target === svgEl && Date.now() - lastGestureAt > PAN_CLICK_MS) {
      options.onClearSelection();
    }
  });
  zoomBehavior.transform(svg, zoomIdentity);

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      layout === "topics"
        ? forceLink<GraphNode, GraphEdge>(simEdges)
            .id((d) => d.id)
            .distance(90)
            .strength(TOPIC_LINK_STRENGTH)
        : forceLink<GraphNode, GraphEdge>(simEdges)
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
    // The centring force would fight the anchors back into one ball.
    simulation.force("center", null);
    simulation.force(
      "cluster",
      forceCluster(simNodes, CLUSTER_STRENGTH, width, height),
    );
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

  /** Frames the whole graph, wherever the forces spread it out to. */
  function fit() {
    const xs = simNodes.map((node) => node.x ?? 0);
    const ys = simNodes.map((node) => node.y ?? 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const scale = Math.min(
      ZOOM_EXTENT[1],
      Math.max(
        ZOOM_EXTENT[0],
        FIT_PADDING *
          Math.min(
            width / Math.max(maxX - minX, 1),
            height / Math.max(maxY - minY, 1),
          ),
      ),
    );
    zoomBehavior.transform(
      svg,
      zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-(minX + maxX) / 2, -(minY + maxY) / 2),
    );
  }

  // The forces settle somewhere unpredictable, so frame the result rather
  // than leaving the reader to hunt for their own site.
  simulation.on("end", () => {
    if (!viewportIsTheirs) fit();
  });
  applyEmphasis();

  return {
    zoomBy: (factor) => {
      viewportIsTheirs = true;
      zoomBehavior.scaleBy(svg, factor);
    },
    fit,
    emphasize: (nextFocusId, nextMatches) => {
      focusId = nextFocusId;
      matches = nextMatches;
      applyEmphasis();
    },
    destroy: () => simulation.stop(),
  };
}
