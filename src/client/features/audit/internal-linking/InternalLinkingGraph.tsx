import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Maximize2, Minimize2, Minus, Plus, Scan } from "lucide-react";
import {
  renderGraph,
  type GraphControls,
} from "@/client/features/audit/internal-linking/graph-render";
import type {
  GraphEdge,
  GraphLayout,
  GraphNode,
} from "@/client/features/audit/internal-linking/graph-model";

const ZOOM_STEP = 1.5;
/**
 * Resizes are quantized to this before they reach state: a fullscreen toggle
 * or a window drag would otherwise restart the simulation on every pixel.
 */
const SIZE_QUANTUM = 24;

/**
 * React shell around the d3 graph: it owns the frame, its size and the
 * viewport buttons. Everything inside the SVG is drawn by graph-render.
 */
export function InternalLinkingGraph({
  nodes,
  edges,
  layout,
  selectedId,
  matchedIds,
  onNodeClick,
  onNodeHide,
  onClearSelection,
  isFullscreen,
  onToggleFullscreen,
  className = "h-[560px]",
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: GraphLayout;
  /** Clicked page: it and its neighbours stay lit, the rest fades back. */
  selectedId: string | null;
  /** Search hits, or null when nothing is being searched for. */
  matchedIds: ReadonlySet<string> | null;
  onNodeClick: (node: GraphNode) => void;
  /** Right-click hides a node, to clear the view around what is being read. */
  onNodeHide: (node: GraphNode) => void;
  /** Clicking the background lets go of the selected page. */
  onClearSelection: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /**
   * Sets the frame's height while the graph sits in the page's flow. Ignored
   * in fullscreen, where the frame covers the whole panel.
   */
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<GraphControls | null>(null);
  const emphasisRef = useRef({ selectedId, matchedIds });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const arrowId = useId();

  // The frame's box drives the drawing, so the same graph fills a card and a
  // fullscreen panel.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const quantize = (value: number) =>
        Math.max(SIZE_QUANTUM, Math.round(value / SIZE_QUANTUM) * SIZE_QUANTUM);
      const next = {
        width: quantize(entry.contentRect.width),
        height: quantize(entry.contentRect.height),
      };
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || nodes.length === 0 || size.width === 0 || size.height === 0) {
      return;
    }
    // Read through the ref: folding selection and search into the deps would
    // restart the simulation on every click and keystroke. The effect below
    // pushes later changes in.
    const controls = renderGraph({
      svgEl,
      nodes,
      edges,
      layout,
      width: size.width,
      height: size.height,
      arrowId,
      focusId: emphasisRef.current.selectedId,
      matches: emphasisRef.current.matchedIds,
      onNodeClick,
      onNodeHide,
      onClearSelection,
    });
    controlsRef.current = controls;
    return () => {
      controls.destroy();
      controlsRef.current = null;
    };
  }, [
    nodes,
    edges,
    layout,
    size,
    arrowId,
    onNodeClick,
    onNodeHide,
    onClearSelection,
  ]);

  useEffect(() => {
    // Also the seed a later re-render of the graph reads, so a rebuild keeps
    // whatever the reader had selected or searched for.
    emphasisRef.current = { selectedId, matchedIds };
    controlsRef.current?.emphasize(selectedId, matchedIds);
  }, [selectedId, matchedIds]);

  const zoomIn = useCallback(() => controlsRef.current?.zoomBy(ZOOM_STEP), []);
  const zoomOut = useCallback(
    () => controlsRef.current?.zoomBy(1 / ZOOM_STEP),
    [],
  );
  const fitToView = useCallback(() => controlsRef.current?.fit(), []);

  return (
    <div
      ref={containerRef}
      // Fullscreen gives the frame the entire panel and the controls float
      // over it: a graph read at arm's length wants every pixel, and a toolbar
      // in the flow above it costs a fifth of the screen.
      className={`w-full overflow-hidden bg-base-100 ${
        isFullscreen
          ? "absolute inset-0"
          : `relative rounded-lg border border-base-300 ${className}`
      }`}
    >
      {nodes.length === 0 ? (
        <p className="absolute inset-0 grid place-items-center text-sm text-base-content/60">
          No pages to visualize.
        </p>
      ) : (
        <svg ref={svgRef} className="block size-full" />
      )}

      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <ViewportButton
          label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={onToggleFullscreen}
        >
          {isFullscreen ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Maximize2 className="size-3.5" />
          )}
        </ViewportButton>
        <ViewportButton label="Zoom in" onClick={zoomIn}>
          <Plus className="size-3.5" />
        </ViewportButton>
        <ViewportButton label="Zoom out" onClick={zoomOut}>
          <Minus className="size-3.5" />
        </ViewportButton>
        <ViewportButton label="Fit to view" onClick={fitToView}>
          <Scan className="size-3.5" />
        </ViewportButton>
      </div>
    </div>
  );
}

function ViewportButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="btn btn-square btn-ghost btn-xs bg-base-100/80"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
