/**
 * The read-only furniture around the graph: the counters above it, the card
 * for the page in focus, and the suggestions below.
 */
import { TriangleAlert, X } from "lucide-react";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import {
  extractUrlPath,
  truncateMiddle,
} from "@/client/features/backlinks/backlinksPageUtils";
import type { AuditResultsData } from "@/client/features/audit/results/types";
import type { GraphNode } from "@/client/features/audit/internal-linking/graph-model";
import type { LinkSuggestionDetails } from "@/client/features/audit/internal-linking/issue-details";

type AuditIssue = AuditResultsData["issues"][number];

export function SelectedPage({
  node,
  onClose,
}: {
  node: GraphNode;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{node.title}</p>
        <p className="text-xs text-base-content/60">
          {node.inboundLinkCount} inbound body link
          {node.inboundLinkCount === 1 ? "" : "s"} ·{" "}
          {(node.pagerank * 100).toFixed(2)} PageRank
          {node.isOrphan && " · no inbound body links"}
          {node.themeLabel && ` · ${node.themeLabel}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <SafeExternalLink
          url={node.id}
          label="Open"
          className="link link-primary text-xs"
        />
        <button
          className="btn btn-ghost btn-xs btn-square"
          onClick={onClose}
          aria-label="Clear selection"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function MetricsStrip({
  pageCount,
  bodyLinkCount,
  templateLinkCount,
  orphanCount,
  brokenCount,
  suggestionCount,
}: {
  pageCount: number;
  bodyLinkCount: number;
  templateLinkCount: number;
  orphanCount: number;
  brokenCount: number;
  suggestionCount: number;
}) {
  const items = [
    { label: "Pages", value: pageCount },
    {
      label: "Body links",
      value: bodyLinkCount,
      hint: "Links inside the page's content — the only ones counted in PageRank, inbound counts and suggestions.",
    },
    {
      label: "Template links",
      value: templateLinkCount,
      hint: "Links repeated across the site in menus, footers and sidebars.",
      valueClass: "text-base-content/50",
    },
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
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-base-300 bg-base-300/70 md:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-base-100 px-4 py-3"
          title={item.hint}
        >
          <p className="text-[11px] uppercase tracking-wider text-base-content/50">
            {item.label}
          </p>
          <p
            className={`mt-0.5 text-xl font-semibold tabular-nums ${item.valueClass ?? ""}`}
          >
            {item.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

export function SuggestionsList({
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
