/**
 * Names the topic clusters produced by theme-clustering.ts from the words
 * their pages carry — the fallback when no model is configured to name them,
 * and the hint given to the model when one is.
 */

import { sort } from "remeda";
import type { ClusterablePage } from "@/server/lib/audit/theme-clustering";

/** Terms joined into one label, e.g. "tomates · semis". */
const TERMS_PER_LABEL = 2;
/**
 * A term on more than this share of the audit's pages is the site's own
 * vocabulary — its brand, its tagline — not a subject that tells two clusters
 * apart. Naming a cluster after it says nothing ("papy · potager" on a site
 * called Papy Potager).
 */
const MAX_DOCUMENT_RATIO = 0.4;
/** Below this many pages a document ratio says nothing, so the guard is off. */
const MIN_DOCUMENTS_FOR_RATIO = 5;
/** Approximates "same word" for labels: one term is a prefix of the other. */
function sharesStem(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.startsWith(shorter);
}

/**
 * Names a cluster after the terms that set it apart: a term's weight inside
 * the cluster over its weight across the whole audit. Plain frequency would
 * label every cluster with the site's own vocabulary ("page", the brand name).
 */
export function labelClusters(
  pages: ClusterablePage[],
  assignments: number[],
  clusterCount: number,
): string[] {
  const globalWeight = new Map<string, number>();
  const documentCount = new Map<string, number>();
  const clusterWeights = Array.from(
    { length: clusterCount },
    () => new Map<string, number>(),
  );

  for (let i = 0; i < pages.length; i++) {
    for (const { term, weight } of pages[i].keywords) {
      globalWeight.set(term, (globalWeight.get(term) ?? 0) + weight);
      documentCount.set(term, (documentCount.get(term) ?? 0) + 1);
      const bucket = clusterWeights[assignments[i]];
      bucket.set(term, (bucket.get(term) ?? 0) + weight);
    }
  }

  const isSiteVocabulary = (term: string) =>
    pages.length >= MIN_DOCUMENTS_FOR_RATIO &&
    (documentCount.get(term) ?? 0) / pages.length > MAX_DOCUMENT_RATIO;

  const used = new Set<string>();
  return clusterWeights.map((weights) => {
    const candidates = Array.from(weights.entries()).filter(
      ([term]) => !isSiteVocabulary(term),
    );
    // A cluster whose every term is site-wide vocabulary still deserves a
    // name; a weak label beats "Group 3".
    const ranked = sort(
      (candidates.length > 0 ? candidates : Array.from(weights.entries())).map(
        ([term, weight]) => ({
          term,
          // Share of the term's site-wide weight that this cluster holds.
          distinctiveness: weight / (globalWeight.get(term) ?? weight),
          weight,
        }),
      ),
      (a, b) =>
        b.distinctiveness * b.weight - a.distinctiveness * a.weight ||
        a.term.localeCompare(b.term),
    );

    const picked: string[] = [];
    for (const { term } of ranked) {
      // Two clusters sharing a headline term would be indistinguishable in the
      // legend, so a term is spent once.
      if (used.has(term)) continue;
      // "tomates · tomate" spends both slots on one idea. Without a stemmer,
      // treating one term as a prefix of another catches the plural and the
      // common inflections that matter here.
      if (picked.some((chosen) => sharesStem(chosen, term))) continue;
      picked.push(term);
      if (picked.length === TERMS_PER_LABEL) break;
    }
    // Last resort before a meaningless "Group 3": reuse a term another
    // cluster already took. A repeated word still says more than a number.
    if (picked.length === 0 && ranked.length > 0) picked.push(ranked[0].term);
    for (const term of picked) used.add(term);

    // Pages with no keywords at all are the redirects and 404s the crawl
    // followed; saying so beats numbering them.
    return picked.length > 0 ? picked.join(" · ") : "No page content";
  });
}
