/**
 * The topic layout's extra force, split out of graph-render to keep both
 * files readable.
 */
import { sort } from "remeda";
import type { GraphNode } from "@/client/features/audit/internal-linking/graph-model";

/**
 * Pull towards the cluster's anchor. It has to overpower thousands of link
 * forces pulling every cluster back into one ball, so it is deliberately
 * strong — this layout trades the real shape for separation.
 */
export const CLUSTER_STRENGTH = 0.9;

/**
 * Lays the clusters out as islands on a ring, one anchor per topic, and pulls
 * each node to its own. Fixed anchors rather than each cluster's centre of
 * mass: a centre of mass drifts with the link forces, so on a densely linked
 * site every cluster converges on the middle and nothing separates.
 *
 * Every link stays drawn, so the layout answers what this view is for — which
 * topics link to which, and which pages carry that traffic between them.
 */
export function forceCluster(
  nodes: GraphNode[],
  strength: number,
  width: number,
  height: number,
) {
  // remeda's sort, not Array#sort (mutates) nor toSorted (ES2023, banned here).
  const themeIds = sort(
    Array.from(
      new Set(
        nodes
          .map((node) => node.themeId)
          .filter((id): id is number => id != null),
      ),
    ),
    (a, b) => a - b,
  );

  const radius = Math.min(width, height) * 0.36;
  const anchors = new Map(
    themeIds.map((id, index) => {
      const angle = (2 * Math.PI * index) / themeIds.length - Math.PI / 2;
      return [
        id,
        {
          x: width / 2 + radius * Math.cos(angle),
          y: height / 2 + radius * Math.sin(angle),
        },
      ];
    }),
  );

  return (alpha: number) => {
    for (const node of nodes) {
      if (node.themeId == null) continue;
      const anchor = anchors.get(node.themeId);
      if (!anchor) continue;
      const pull = strength * alpha;
      node.vx = (node.vx ?? 0) + (anchor.x - (node.x ?? 0)) * pull;
      node.vy = (node.vy ?? 0) + (anchor.y - (node.y ?? 0)) * pull;
    }
  };
}
