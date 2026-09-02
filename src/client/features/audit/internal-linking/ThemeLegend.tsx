import { useMemo } from "react";
import { sort } from "remeda";
import {
  themeColorForId,
  type GraphNode,
} from "@/client/features/audit/internal-linking/InternalLinkingGraph";

/**
 * Names the colours. Without it the clusters are decoration: the reader can
 * see that two pages differ but not what separates them.
 */
export function ThemeLegend({
  nodes,
  splittableThemes,
  onDrillInto,
}: {
  nodes: GraphNode[];
  splittableThemes: Set<number>;
  /** Absent while already inside a theme: sub-clusters are not split further. */
  onDrillInto?: (themeId: number) => void;
}) {
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
      {themes.map((theme) => {
        const canDrill = onDrillInto && splittableThemes.has(theme.id);
        const swatch = (
          <>
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: themeColorForId(theme.id) }}
            />
            <span className={canDrill ? "underline decoration-dotted" : ""}>
              {theme.label}
            </span>
            <span className="text-base-content/40">{theme.count}</span>
          </>
        );

        return canDrill ? (
          <button
            key={theme.id}
            className="flex items-center gap-1.5 text-xs text-base-content/80 hover:text-base-content"
            title="Show the sub-topics inside this one"
            onClick={() => onDrillInto(theme.id)}
          >
            {swatch}
          </button>
        ) : (
          <span
            key={theme.id}
            className="flex items-center gap-1.5 text-xs text-base-content/80"
          >
            {swatch}
          </span>
        );
      })}
    </div>
  );
}
