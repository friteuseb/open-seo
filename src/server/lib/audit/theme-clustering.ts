/**
 * Groups an audit's pages into topical clusters for the internal-linking
 * graph, so the visualization can colour pages by subject.
 *
 * Grouping runs on the page embeddings already computed for similarity
 * (spherical k-means over cosine distance) and falls back to the TF-IDF
 * keywords when the deployment has no embedding endpoint. Either way the
 * cluster *label* comes from the keywords: a vector says which pages belong
 * together, only words can say what they are about.
 */

import { sort } from "remeda";
import type { PageKeyword } from "@/server/lib/audit/keyword-extraction";

export interface ClusterablePage {
  pageId: string;
  keywords: PageKeyword[];
}

interface PageTheme {
  pageId: string;
  /** Stable index of the cluster within this audit, for colour assignment. */
  themeId: number;
  /** Human-readable cluster name, derived from its most distinctive terms. */
  themeLabel: string;
}

/**
 * Clusters stay readable on a legend and distinguishable by colour, so the
 * count is bounded regardless of site size.
 */
const MIN_CLUSTERS = 2;
const MAX_CLUSTERS = 10;
const MAX_ITERATIONS = 20;
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

/**
 * Roughly one cluster per 60 pages, bounded. Enough separation to be useful
 * on a large site without producing more colours than a reader can hold.
 */
export function chooseClusterCount(pageCount: number): number {
  if (pageCount < 2 * MIN_CLUSTERS) return Math.min(pageCount, MIN_CLUSTERS);
  const suggested = Math.round(pageCount / 60);
  return Math.max(MIN_CLUSTERS, Math.min(MAX_CLUSTERS, suggested));
}

function l2Normalize(vector: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;
  const norm = Math.sqrt(sumOfSquares);
  // A zero vector has no direction; leave it untouched rather than dividing by
  // zero — it will simply never be closer to one centroid than another.
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

/** Cosine similarity, given both inputs are already L2-normalized. */
function dot(a: number[], b: number[]): number {
  let total = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) total += a[i] * b[i];
  return total;
}

/**
 * k-means++ seeding without a random source: the first centre is the vector
 * furthest from the corpus mean, and each next centre is the vector furthest
 * from every centre chosen so far. Deterministic seeding keeps a re-run of the
 * same audit from reshuffling every colour.
 */
function seedCentroids(vectors: number[][], k: number): number[][] {
  const dimensions = vectors[0].length;
  const mean = Array.from<number>({ length: dimensions }).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < dimensions; i++) mean[i] += vector[i] / vectors.length;
  }

  const centroids: number[][] = [];
  const meanDirection = l2Normalize(mean);
  let seed = vectors[0];
  let lowest = Infinity;
  for (const vector of vectors) {
    const similarity = dot(vector, meanDirection);
    if (similarity < lowest) {
      lowest = similarity;
      seed = vector;
    }
  }
  centroids.push(seed);

  while (centroids.length < k) {
    let best = vectors[0];
    let bestSimilarity = Infinity;
    for (const vector of vectors) {
      // Similarity to the *closest* centre chosen so far; the next centre is
      // the vector for which that is lowest, which spreads centres apart.
      let closest = -Infinity;
      for (const centroid of centroids) {
        const similarity = dot(vector, centroid);
        if (similarity > closest) closest = similarity;
      }
      if (closest < bestSimilarity) {
        bestSimilarity = closest;
        best = vector;
      }
    }
    centroids.push(best);
  }

  return centroids;
}

function assignToNearest(vectors: number[][], centroids: number[][]): number[] {
  return vectors.map((vector) => {
    let bestIndex = 0;
    let bestSimilarity = -Infinity;
    for (let i = 0; i < centroids.length; i++) {
      const similarity = dot(vector, centroids[i]);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = i;
      }
    }
    return bestIndex;
  });
}

function recomputeCentroids(
  vectors: number[][],
  assignments: number[],
  k: number,
  previous: number[][],
): number[][] {
  const dimensions = vectors[0].length;
  const sums = Array.from({ length: k }, () =>
    Array.from<number>({ length: dimensions }).fill(0),
  );
  const counts = Array.from<number>({ length: k }).fill(0);

  for (let i = 0; i < vectors.length; i++) {
    const cluster = assignments[i];
    counts[cluster] += 1;
    for (let d = 0; d < dimensions; d++) sums[cluster][d] += vectors[i][d];
  }

  return sums.map((sum, cluster) =>
    // An emptied cluster keeps its previous centre instead of collapsing to
    // the origin, where it would win no page ever again.
    counts[cluster] === 0 ? previous[cluster] : l2Normalize(sum),
  );
}

/** Spherical k-means. Returns one cluster index per input vector. */
function kMeans(vectors: number[][], k: number): number[] {
  let centroids = seedCentroids(vectors, k);
  let assignments = assignToNearest(vectors, centroids);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    centroids = recomputeCentroids(vectors, assignments, k, centroids);
    const next = assignToNearest(vectors, centroids);
    if (next.every((cluster, i) => cluster === assignments[i])) break;
    assignments = next;
  }

  return assignments;
}

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
function labelClusters(
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
  return clusterWeights.map((weights, cluster) => {
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

    return picked.length > 0 ? picked.join(" · ") : `Group ${cluster + 1}`;
  });
}

/**
 * Fallback grouping when no embeddings are available: each page joins the
 * cluster of its own strongest term, keeping the most common such terms.
 */
function clusterByKeywords(pages: ClusterablePage[]): number[] {
  const dominantTermCount = new Map<string, number>();
  const dominantTerms = pages.map((page) => {
    const top = sort(page.keywords, (a, b) => b.weight - a.weight)[0]?.term;
    if (top) dominantTermCount.set(top, (dominantTermCount.get(top) ?? 0) + 1);
    return top;
  });

  const keptTerms = sort(
    Array.from(dominantTermCount.entries()),
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
    .slice(0, chooseClusterCount(pages.length))
    .map(([term]) => term);

  const clusterOfTerm = new Map(keptTerms.map((term, index) => [term, index]));
  // Pages whose dominant term did not make the cut land in the last cluster,
  // which the label pass names from whatever those pages have in common.
  const fallbackCluster = Math.max(0, keptTerms.length - 1);
  return dominantTerms.map((term) =>
    term != null
      ? (clusterOfTerm.get(term) ?? fallbackCluster)
      : fallbackCluster,
  );
}

/**
 * Assigns every page a topical cluster. `vectors` must be aligned with
 * `pages`; pass null when the deployment has no embedding endpoint.
 */
export function assignPageThemes(
  pages: ClusterablePage[],
  vectors: number[][] | null,
): PageTheme[] {
  if (pages.length === 0) return [];

  const usableVectors =
    vectors != null &&
    vectors.length === pages.length &&
    vectors.every((vector) => vector.length > 0)
      ? vectors.map(l2Normalize)
      : null;

  const clusterCount = chooseClusterCount(pages.length);
  const assignments = usableVectors
    ? kMeans(usableVectors, clusterCount)
    : clusterByKeywords(pages);

  const labels = labelClusters(
    pages,
    assignments,
    Math.max(clusterCount, Math.max(0, ...assignments) + 1),
  );

  return pages.map((page, index) => ({
    pageId: page.pageId,
    themeId: assignments[index],
    themeLabel: labels[assignments[index]],
  }));
}
