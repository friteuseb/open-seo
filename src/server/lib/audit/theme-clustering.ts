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
import { labelClusters } from "@/server/lib/audit/theme-labels";

/**
 * A theme is only split when it is big enough that a reader cannot take it in
 * at once — below this, drilling in would just re-draw the same pages.
 */
const MIN_PAGES_TO_SPLIT = 20;
/** Sub-clusters per theme: one per 25 pages, so a 160-page theme yields ~6. */
const PAGES_PER_SUBCLUSTER = 25;
const MAX_SUBCLUSTERS = 8;

/**
 * Roughly one cluster per 30 pages, bounded. Coarser than this and a site
 * whose pages follow one template (product or plant sheets, say) collapses
 * into a single colour that separates nothing.
 */
const PAGES_PER_CLUSTER = 30;

export function chooseClusterCount(pageCount: number): number {
  if (pageCount < 2 * MIN_CLUSTERS) return Math.min(pageCount, MIN_CLUSTERS);
  const suggested = Math.round(pageCount / PAGES_PER_CLUSTER);
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
  /**
   * Index of the page's sub-cluster within its own theme, or null when the
   * theme was too small to split. Lets the graph drill into a large theme
   * without spending more colours on the top-level legend.
   */
  subThemeId: number | null;
  subThemeLabel: string | null;
}

/**
 * Clusters stay readable on a legend and distinguishable by colour, so the
 * count is bounded regardless of site size.
 */
const MIN_CLUSTERS = 2;
const MAX_CLUSTERS = 10;
const MAX_ITERATIONS = 20;
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
/**
 * Splits each large theme into sub-clusters, so a reader can drill into
 * "Semis et plantation" and find the water plants inside it. Runs the same
 * k-means within a single theme's pages, which is why a small section can
 * surface here without spending one of the ten top-level colours on it.
 *
 * Returns one entry per page index, null for pages in themes left whole.
 */
function assignSubThemes(
  pages: ClusterablePage[],
  vectors: number[][] | null,
  assignments: number[],
): Array<{ subThemeId: number; subThemeLabel: string } | null> {
  const result = Array.from<{
    subThemeId: number;
    subThemeLabel: string;
  } | null>({ length: pages.length }).fill(null);

  const indexesByTheme = new Map<number, number[]>();
  for (let i = 0; i < assignments.length; i++) {
    const bucket = indexesByTheme.get(assignments[i]) ?? [];
    bucket.push(i);
    indexesByTheme.set(assignments[i], bucket);
  }

  for (const indexes of indexesByTheme.values()) {
    if (indexes.length < MIN_PAGES_TO_SPLIT) continue;

    const subCount = Math.max(
      2,
      Math.min(
        MAX_SUBCLUSTERS,
        Math.round(indexes.length / PAGES_PER_SUBCLUSTER),
      ),
    );
    const themePages = indexes.map((i) => pages[i]);
    const subAssignments = vectors
      ? kMeans(
          indexes.map((i) => vectors[i]),
          subCount,
        )
      : clusterByKeywords(themePages);

    const subLabels = labelClusters(
      themePages,
      subAssignments,
      Math.max(subCount, Math.max(0, ...subAssignments) + 1),
    );

    for (let n = 0; n < indexes.length; n++) {
      result[indexes[n]] = {
        subThemeId: subAssignments[n],
        subThemeLabel: subLabels[subAssignments[n]],
      };
    }
  }

  return result;
}

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
  const subThemes = assignSubThemes(pages, usableVectors, assignments);

  return pages.map((page, index) => ({
    pageId: page.pageId,
    themeId: assignments[index],
    themeLabel: labels[assignments[index]],
    subThemeId: subThemes[index]?.subThemeId ?? null,
    subThemeLabel: subThemes[index]?.subThemeLabel ?? null,
  }));
}
