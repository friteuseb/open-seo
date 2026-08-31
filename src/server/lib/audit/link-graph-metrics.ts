/**
 * Pure internal-link-graph metrics: PageRank, centrality, and site-wide
 * stats over a node/edge set. Runs inside the audit's scratchpad Durable
 * Object (the only place the full internal-link edge list exists) but has
 * no DO/SQLite dependency itself, so it's unit-testable in isolation.
 */

export interface LinkGraphEdge {
  sourcePageId: string;
  targetPageId: string;
}

export interface PageLinkMetrics {
  pageId: string;
  inboundLinkCount: number;
  outboundLinkCount: number;
  pagerank: number;
  centralityScore: number;
}

export interface LinkGraphStats {
  totalPages: number;
  totalLinks: number;
  orphanedPages: number;
  networkDensity: number;
  avgLinksPerPage: number;
}

const DAMPING_FACTOR = 0.85;
const ITERATIONS = 20;

function computePageRank(
  nodeIds: string[],
  edges: LinkGraphEdge[],
): Map<string, number> {
  const n = nodeIds.length;
  if (n === 0) return new Map();

  const outDegree = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    outDegree.set(
      edge.sourcePageId,
      (outDegree.get(edge.sourcePageId) ?? 0) + 1,
    );
    const list = incoming.get(edge.targetPageId);
    if (list) list.push(edge.sourcePageId);
    else incoming.set(edge.targetPageId, [edge.sourcePageId]);
  }

  let rank = new Map(nodeIds.map((id) => [id, 1 / n]));

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const next = new Map<string, number>();
    for (const id of nodeIds) {
      let sum = 0;
      for (const sourceId of incoming.get(id) ?? []) {
        const degree = outDegree.get(sourceId) ?? 0;
        if (degree > 0) sum += (rank.get(sourceId) ?? 0) / degree;
      }
      next.set(id, (1 - DAMPING_FACTOR) / n + DAMPING_FACTOR * sum);
    }
    rank = next;
  }

  return rank;
}

/**
 * Per-page metrics plus site-wide stats for one audit's internal-link
 * graph. `nodeIds` should be every crawled page id, including pages with no
 * links at all, so counts and density reflect the whole crawled set.
 */
export function computeLinkGraphMetrics(
  nodeIds: string[],
  edges: LinkGraphEdge[],
): { pageMetrics: PageLinkMetrics[]; stats: LinkGraphStats } {
  const inboundCount = new Map<string, number>();
  const outboundCount = new Map<string, number>();
  for (const edge of edges) {
    outboundCount.set(
      edge.sourcePageId,
      (outboundCount.get(edge.sourcePageId) ?? 0) + 1,
    );
    inboundCount.set(
      edge.targetPageId,
      (inboundCount.get(edge.targetPageId) ?? 0) + 1,
    );
  }

  const pagerank = computePageRank(nodeIds, edges);
  const totalLinks = edges.length;

  const pageMetrics: PageLinkMetrics[] = nodeIds.map((pageId) => {
    const inbound = inboundCount.get(pageId) ?? 0;
    const outbound = outboundCount.get(pageId) ?? 0;
    return {
      pageId,
      inboundLinkCount: inbound,
      outboundLinkCount: outbound,
      pagerank: pagerank.get(pageId) ?? 0,
      centralityScore:
        totalLinks > 0 ? (inbound + outbound) / (2 * totalLinks) : 0,
    };
  });

  const orphanedPages = pageMetrics.filter(
    (page) => page.inboundLinkCount === 0,
  ).length;
  const totalPages = nodeIds.length;
  const maxPossibleLinks = totalPages * (totalPages - 1);

  return {
    pageMetrics,
    stats: {
      totalPages,
      totalLinks,
      orphanedPages,
      networkDensity: maxPossibleLinks > 0 ? totalLinks / maxPossibleLinks : 0,
      avgLinksPerPage: totalPages > 0 ? totalLinks / totalPages : 0,
    },
  };
}
