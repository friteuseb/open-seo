import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  inboundLinkCount: number;
  pagerank: number;
  isOrphan: boolean;
  /** Topical cluster from the audit, or null when themes were not computed. */
  themeId: number | null;
  themeLabel: string | null;
  /** Sub-cluster inside that theme, when the theme was large enough to split. */
  subThemeId: number | null;
  subThemeLabel: string | null;
}

export interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  /**
   * "body" and "template" are links the crawl found, split by where on the
   * page they sit; the others are findings.
   */
  kind: "body" | "template" | "broken" | "suggested";
  score?: number;
}

/**
 * "links" lays the graph out on its link forces alone — the real shape of the
 * internal linking. "topics" adds a pull towards each cluster's centre, which
 * separates the subjects at the cost of distorting that shape.
 */
export type GraphLayout = "links" | "topics";

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

/** Shared with the legend so a swatch always matches its nodes. */
export function themeColorForId(themeId: number | null): string {
  if (themeId == null) return UNTHEMED_COLOR;
  return THEME_COLORS[themeId % THEME_COLORS.length];
}
