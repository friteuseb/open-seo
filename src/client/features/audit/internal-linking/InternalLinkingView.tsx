import { useCallback, useMemo, useRef, useState } from "react";
import { sort } from "remeda";
import { Network, Search } from "lucide-react";
import type { AuditResultsData } from "@/client/features/audit/results/types";
import {
  MetricsStrip,
  SelectedPage,
  SuggestionsList,
} from "@/client/features/audit/internal-linking/InternalLinkingPanels";
import { ThemeLegend } from "@/client/features/audit/internal-linking/ThemeLegend";
import { useFullscreen } from "@/client/features/audit/internal-linking/useFullscreen";
import { InternalLinkingGraph } from "@/client/features/audit/internal-linking/InternalLinkingGraph";
import type {
  GraphEdge,
  GraphLayout,
  GraphNode,
} from "@/client/features/audit/internal-linking/graph-model";

import {
  parseBrokenLinkDetails,
  parseLinkSuggestionDetails,
  type BrokenLinkDetails,
  type LinkSuggestionDetails,
} from "@/client/features/audit/internal-linking/issue-details";

type AuditPage = AuditResultsData["pages"][number];
type AuditLink = AuditResultsData["links"][number];
type AuditIssue = AuditResultsData["issues"][number];

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
  // Drilling into one theme: its pages are recoloured by sub-cluster and the
  // rest of the site greys out. Keeps small sections findable without giving
  // them one of the ten top-level colours.
  const [drilledTheme, setDrilledTheme] = useState<number | null>(null);
  // Right-click hides a page so a dense graph can be read. Hidden, not
  // dropped: the audit's data is untouched and one click brings them back.
  const [hiddenUrls, setHiddenUrls] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Menu, footer and sidebar links connect every page to every other one.
  // They are off by default: with them drawn the graph shows the template,
  // not the editorial structure the metrics are computed from.
  const [showTemplateLinks, setShowTemplateLinks] = useState(false);
  const [query, setQuery] = useState("");

  const panelRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(panelRef);

  const hideNode = useCallback((node: GraphNode) => {
    setHiddenUrls((current) => new Set(current).add(node.id));
    setSelectedNode((current) => (current?.id === node.id ? null : current));
  }, []);

  const showAllNodes = useCallback(() => setHiddenUrls(new Set()), []);
  const clearSelection = useCallback(() => setSelectedNode(null), []);
  const selectNode = useCallback(
    (node: GraphNode) =>
      setSelectedNode((current) => (current?.id === node.id ? null : node)),
    [],
  );

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
      subThemeId: page.subThemeId ?? null,
      subThemeLabel: page.subThemeLabel ?? null,
    }));

    const graphEdges: GraphEdge[] = [];
    const pageUrlById = new Map(pages.map((page) => [page.id, page.url]));
    for (const link of links) {
      const source = pageUrlById.get(link.sourcePageId);
      const target = pageUrlById.get(link.targetPageId);
      if (!source || !target || source === target) continue;
      graphEdges.push({
        source,
        target,
        kind: link.isBoilerplate ? "template" : "body",
      });
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

  // Only themes the audit actually split can be drilled into.
  const splittableThemes = useMemo(() => {
    const ids = new Set<number>();
    for (const node of nodes) {
      if (node.themeId != null && node.subThemeId != null)
        ids.add(node.themeId);
    }
    return ids;
  }, [nodes]);

  const linkCounts = useMemo(() => {
    let body = 0;
    let template = 0;
    for (const edge of edges) {
      if (edge.kind === "body") body += 1;
      else if (edge.kind === "template") template += 1;
    }
    return { body, template };
  }, [edges]);

  // Inside a theme, colour by sub-cluster and grey out everything else, so the
  // drill-down reads as "zooming in" rather than as a different graph.
  const drilledNodes = useMemo(() => {
    if (drilledTheme == null) return nodes;
    return nodes.map((node) =>
      node.themeId === drilledTheme
        ? {
            ...node,
            themeId: node.subThemeId,
            themeLabel: node.subThemeLabel,
          }
        : { ...node, themeId: null, themeLabel: null },
    );
  }, [nodes, drilledTheme]);

  // An edge to a hidden page would dangle, so both ends must still be visible.
  const { visibleNodes, visibleEdges } = useMemo(() => {
    const keptEdges = showTemplateLinks
      ? edges
      : edges.filter((edge) => edge.kind !== "template");
    if (hiddenUrls.size === 0)
      return { visibleNodes: drilledNodes, visibleEdges: keptEdges };
    return {
      visibleNodes: drilledNodes.filter((node) => !hiddenUrls.has(node.id)),
      visibleEdges: keptEdges.filter(
        (edge) =>
          typeof edge.source === "string" &&
          typeof edge.target === "string" &&
          !hiddenUrls.has(edge.source) &&
          !hiddenUrls.has(edge.target),
      ),
    };
  }, [drilledNodes, edges, hiddenUrls, showTemplateLinks]);

  // Search dims the rest of the graph rather than removing it: where a page
  // sits among its neighbours is most of what the reader came for.
  const matchedIds = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const matches = new Set<string>();
    for (const node of visibleNodes) {
      if (
        node.title.toLowerCase().includes(needle) ||
        node.id.toLowerCase().includes(needle)
      ) {
        matches.add(node.id);
      }
    }
    return matches;
  }, [query, visibleNodes]);

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
        bodyLinkCount={linkCounts.body}
        templateLinkCount={linkCounts.template}
        orphanCount={orphanCount}
        brokenCount={brokenLinks.length}
        suggestionCount={suggestions.length}
      />

      <div
        ref={panelRef}
        className={`flex flex-col gap-3 ${
          isFullscreen ? "h-screen w-screen bg-base-100 p-4" : ""
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
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

          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-base-content/40" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a page"
              aria-label="Find a page"
              className="input input-sm input-bordered w-48 pl-7"
            />
          </label>

          <label
            className="flex cursor-pointer items-center gap-2 text-xs text-base-content/70"
            title="Menu, footer and sidebar links. They are excluded from PageRank, inbound counts and suggestions."
          >
            <input
              type="checkbox"
              className="toggle toggle-xs"
              checked={showTemplateLinks}
              onChange={(event) => setShowTemplateLinks(event.target.checked)}
            />
            Show template links
          </label>

          <span className="ml-auto text-xs text-base-content/50">
            {matchedIds
              ? `${matchedIds.size.toLocaleString()} of ${visibleNodes.length.toLocaleString()} pages match`
              : `${linkCounts.body.toLocaleString()} body links · ${linkCounts.template.toLocaleString()} in the template`}
          </span>
        </div>

        <InternalLinkingGraph
          nodes={visibleNodes}
          edges={visibleEdges}
          layout={layout}
          selectedId={selectedNode?.id ?? null}
          matchedIds={matchedIds}
          onNodeClick={selectNode}
          onNodeHide={hideNode}
          onClearSelection={clearSelection}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          className={isFullscreen ? "min-h-0 flex-1" : "h-[560px]"}
        />

        <div className="flex flex-wrap items-center gap-3">
          <ThemeLegend
            nodes={visibleNodes}
            splittableThemes={splittableThemes}
            onDrillInto={drilledTheme == null ? setDrilledTheme : undefined}
          />
          {drilledTheme != null && (
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setDrilledTheme(null)}
            >
              ← All topics
            </button>
          )}
          {hiddenUrls.size > 0 && (
            <button className="btn btn-ghost btn-xs" onClick={showAllNodes}>
              Show {hiddenUrls.size} hidden page
              {hiddenUrls.size === 1 ? "" : "s"}
            </button>
          )}
        </div>

        {selectedNode ? (
          <SelectedPage node={selectedNode} onClose={clearSelection} />
        ) : (
          <p className="text-xs text-base-content/50">
            Click a page to light up what it links to and what links to it ·
            right-click to hide it · scroll to zoom
          </p>
        )}
      </div>

      <SuggestionsList suggestions={suggestions} />
    </div>
  );
}
