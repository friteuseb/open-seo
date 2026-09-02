import { useCallback, useMemo, useState } from "react";
import { sort } from "remeda";
import { Network, TriangleAlert } from "lucide-react";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import {
  extractUrlPath,
  truncateMiddle,
} from "@/client/features/backlinks/backlinksPageUtils";
import type { AuditResultsData } from "@/client/features/audit/results/types";
import {
  InternalLinkingGraph,
  themeColorForId,
  type GraphEdge,
  type GraphLayout,
  type GraphNode,
} from "@/client/features/audit/internal-linking/InternalLinkingGraph";

type AuditPage = AuditResultsData["pages"][number];
type AuditLink = AuditResultsData["links"][number];
type AuditIssue = AuditResultsData["issues"][number];

interface LinkSuggestionDetails {
  targetUrl: string;
  similarityScore: number;
}

interface BrokenLinkDetails {
  targetUrl: string;
  targetStatus: number;
}

function parseLinkSuggestionDetails(
  issue: AuditIssue,
): LinkSuggestionDetails | null {
  if (!issue.detailsJson) return null;
  try {
    const parsed: unknown = JSON.parse(issue.detailsJson);
    if (
      parsed &&
      typeof parsed === "object" &&
      "targetUrl" in parsed &&
      "similarityScore" in parsed &&
      typeof parsed.targetUrl === "string" &&
      typeof parsed.similarityScore === "number"
    ) {
      return {
        targetUrl: parsed.targetUrl,
        similarityScore: parsed.similarityScore,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function parseBrokenLinkDetails(issue: AuditIssue): BrokenLinkDetails | null {
  if (!issue.detailsJson) return null;
  try {
    const parsed: unknown = JSON.parse(issue.detailsJson);
    if (
      parsed &&
      typeof parsed === "object" &&
      "targetUrl" in parsed &&
      "targetStatus" in parsed &&
      typeof parsed.targetUrl === "string" &&
      typeof parsed.targetStatus === "number"
    ) {
      return { targetUrl: parsed.targetUrl, targetStatus: parsed.targetStatus };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Names the colours. Without it the clusters are decoration: the reader can
 * see that two pages differ but not what separates them.
 */
function ThemeLegend({ nodes }: { nodes: GraphNode[] }) {
  const themes = useMemo(() => {
    const byId = new Map<number, { label: string; count: number }>();
    for (const node of nodes) {
      if (node.themeId == null || !node.themeLabel) continue;
      const entry = byId.get(node.themeId) ?? {
        label: node.themeLabel,
        count: 0,
      };
      entry.count += 1;
      byId.set(node.themeId, entry);
    }
    return sort(
      Array.from(byId.entries()).map(([id, entry]) => ({ id, ...entry })),
      (a, b) => b.count - a.count,
    );
  }, [nodes]);

  if (themes.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-base-300 bg-base-200/20 px-3 py-2">
      <span className="text-xs font-medium uppercase tracking-wide text-base-content/60">
        Topics
      </span>
      {themes.map((theme) => (
        <span key={theme.id} className="flex items-center gap-1.5 text-xs">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: themeColorForId(theme.id) }}
          />
          <span className="text-base-content/80">{theme.label}</span>
          <span className="text-base-content/40">{theme.count}</span>
        </span>
      ))}
    </div>
  );
}

export function InternalLinkingView({
  pages,
  issues,
  links,
}: {
  pages: AuditPage[];
  issues: AuditIssue[];
  links: AuditLink[];
}) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  // The graph is first about how pages link to each other; topics are a
  // reading of that, not a replacement for it. "links" keeps the layout
  // driven purely by the link forces, "topics" pulls each cluster together.
  const [layout, setLayout] = useState<GraphLayout>("links");
  // Right-click hides a page so a dense graph can be read. Hidden, not
  // dropped: the audit's data is untouched and one click brings them back.
  const [hiddenUrls, setHiddenUrls] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const hideNode = useCallback((node: GraphNode) => {
    setHiddenUrls((current) => new Set(current).add(node.id));
    setSelectedNode((current) => (current?.id === node.id ? null : current));
  }, []);

  const showAllNodes = useCallback(() => setHiddenUrls(new Set()), []);

  const pagesByUrl = useMemo(
    () => new Map(pages.map((page) => [page.url, page])),
    [pages],
  );

  const suggestions = useMemo(
    () =>
      sort(
        issues
          .filter((issue) => issue.issueType === "internal-linking-opportunity")
          .map((issue) => ({
            issue,
            details: parseLinkSuggestionDetails(issue),
          }))
          .filter(
            (
              row,
            ): row is { issue: AuditIssue; details: LinkSuggestionDetails } =>
              row.details !== null,
          ),
        (a, b) => b.details.similarityScore - a.details.similarityScore,
      ),
    [issues],
  );

  const brokenLinks = useMemo(
    () =>
      issues
        .filter((issue) => issue.issueType === "broken-internal-link")
        .map((issue) => ({
          issue,
          details: parseBrokenLinkDetails(issue),
        }))
        .filter(
          (row): row is { issue: AuditIssue; details: BrokenLinkDetails } =>
            row.details !== null,
        ),
    [issues],
  );

  const orphanCount = useMemo(
    () => issues.filter((issue) => issue.issueType === "orphan-page").length,
    [issues],
  );

  const hasGraphMetrics = pages.some((page) => page.inboundLinkCount != null);

  const { nodes, edges } = useMemo(() => {
    const graphNodes: GraphNode[] = pages.map((page) => ({
      id: page.url,
      title: page.title || page.url,
      inboundLinkCount: page.inboundLinkCount ?? 0,
      pagerank: page.pagerank ?? 0,
      isOrphan: (page.inboundLinkCount ?? 0) === 0,
      themeId: page.themeId ?? null,
      themeLabel: page.themeLabel ?? null,
    }));

    const graphEdges: GraphEdge[] = [];
    const pageUrlById = new Map(pages.map((page) => [page.id, page.url]));
    for (const link of links) {
      const source = pageUrlById.get(link.sourcePageId);
      const target = pageUrlById.get(link.targetPageId);
      if (!source || !target || source === target) continue;
      graphEdges.push({ source, target, kind: "internal" });
    }
    for (const { issue, details } of brokenLinks) {
      if (!pagesByUrl.has(issue.pageUrl) || !pagesByUrl.has(details.targetUrl))
        continue;
      graphEdges.push({
        source: issue.pageUrl,
        target: details.targetUrl,
        kind: "broken",
      });
    }
    for (const { issue, details } of suggestions) {
      if (!pagesByUrl.has(issue.pageUrl) || !pagesByUrl.has(details.targetUrl))
        continue;
      graphEdges.push({
        source: issue.pageUrl,
        target: details.targetUrl,
        kind: "suggested",
        score: details.similarityScore,
      });
    }

    return { nodes: graphNodes, edges: graphEdges };
  }, [pages, pagesByUrl, brokenLinks, suggestions, links]);

  const internalEdgeCount = useMemo(
    () => edges.filter((edge) => edge.kind === "internal").length,
    [edges],
  );

  // An edge to a hidden page would dangle, so both ends must still be visible.
  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (hiddenUrls.size === 0)
      return { visibleNodes: nodes, visibleEdges: edges };
    return {
      visibleNodes: nodes.filter((node) => !hiddenUrls.has(node.id)),
      visibleEdges: edges.filter(
        (edge) =>
          typeof edge.source === "string" &&
          typeof edge.target === "string" &&
          !hiddenUrls.has(edge.source) &&
          !hiddenUrls.has(edge.target),
      ),
    };
  }, [nodes, edges, hiddenUrls]);

  if (!hasGraphMetrics) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-base-300 bg-base-200/40 px-4 py-3 text-sm text-base-content/70">
        <Network className="mt-0.5 size-4 shrink-0" />
        <p>
          Internal-linking metrics aren't available for this audit. Re-run the
          audit to compute the link graph and similarity suggestions.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <MetricsStrip
        pageCount={pages.length}
        orphanCount={orphanCount}
        brokenCount={brokenLinks.length}
        suggestionCount={suggestions.length}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" className="tabs tabs-boxed tabs-sm">
          <button
            role="tab"
            className={`tab ${layout === "links" ? "tab-active" : ""}`}
            onClick={() => setLayout("links")}
          >
            Link graph
          </button>
          <button
            role="tab"
            className={`tab ${layout === "topics" ? "tab-active" : ""}`}
            onClick={() => setLayout("topics")}
          >
            Grouped by topic
          </button>
        </div>
        <span className="text-xs text-base-content/50">
          {internalEdgeCount.toLocaleString()} internal links
        </span>
      </div>

      <InternalLinkingGraph
        nodes={visibleNodes}
        edges={visibleEdges}
        layout={layout}
        onNodeClick={setSelectedNode}
        onNodeHide={hideNode}
      />

      <div className="flex flex-wrap items-center gap-3">
        <ThemeLegend nodes={visibleNodes} />
        {hiddenUrls.size > 0 && (
          <button className="btn btn-ghost btn-xs" onClick={showAllNodes}>
            Show {hiddenUrls.size} hidden page
            {hiddenUrls.size === 1 ? "" : "s"}
          </button>
        )}
      </div>
      <p className="text-xs text-base-content/50">
        Click a node for details · right-click to hide it · scroll to zoom
      </p>

      {selectedNode && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium truncate">{selectedNode.title}</p>
            <p className="text-xs text-base-content/60">
              {selectedNode.inboundLinkCount} inbound ·{" "}
              {(selectedNode.pagerank * 100).toFixed(2)} PageRank
              {selectedNode.isOrphan && " · orphaned"}
              {selectedNode.themeLabel && ` · ${selectedNode.themeLabel}`}
            </p>
          </div>
          <SafeExternalLink
            url={selectedNode.id}
            label="Open"
            className="link link-primary text-xs shrink-0 ml-3"
          />
        </div>
      )}

      <SuggestionsList suggestions={suggestions} />
    </div>
  );
}

function MetricsStrip({
  pageCount,
  orphanCount,
  brokenCount,
  suggestionCount,
}: {
  pageCount: number;
  orphanCount: number;
  brokenCount: number;
  suggestionCount: number;
}) {
  const items = [
    { label: "Pages", value: pageCount },
    {
      label: "Orphaned pages",
      value: orphanCount,
      valueClass: orphanCount > 0 ? "text-warning" : "text-success",
    },
    {
      label: "Broken internal links",
      value: brokenCount,
      valueClass: brokenCount > 0 ? "text-error" : "text-success",
    },
    { label: "Linking opportunities", value: suggestionCount },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-lg border border-base-300 bg-base-300/70 overflow-hidden">
      {items.map((item) => (
        <div key={item.label} className="bg-base-100 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-base-content/50">
            {item.label}
          </p>
          <p
            className={`text-xl font-semibold mt-0.5 tabular-nums ${item.valueClass ?? ""}`}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function SuggestionsList({
  suggestions,
}: {
  suggestions: Array<{ issue: AuditIssue; details: LinkSuggestionDetails }>;
}) {
  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-base-content/60 py-4 text-center">
        No linking opportunities found — either the site is well cross-linked,
        or no similar-enough pages were found.
      </p>
    );
  }

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-2">
        <h3 className="font-medium text-sm flex items-center gap-2">
          <TriangleAlert className="size-4 text-base-content/50" />
          Suggested internal links
        </h3>
        <ul className="flex flex-col divide-y divide-base-200">
          {suggestions.map(({ issue, details }) => (
            <li
              key={`${issue.pageUrl}->${details.targetUrl}`}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <div className="min-w-0 flex items-center gap-2 flex-wrap">
                <SafeExternalLink
                  url={issue.pageUrl}
                  label={truncateMiddle(extractUrlPath(issue.pageUrl), 40)}
                  className="link link-hover"
                />
                <span className="text-base-content/40">&rarr;</span>
                <SafeExternalLink
                  url={details.targetUrl}
                  label={truncateMiddle(extractUrlPath(details.targetUrl), 40)}
                  className="link link-hover"
                />
              </div>
              <span className="badge badge-ghost badge-sm shrink-0 tabular-nums">
                {Math.round(details.similarityScore * 100)}% similar
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
