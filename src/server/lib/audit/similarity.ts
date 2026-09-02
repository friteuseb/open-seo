/**
 * TF-IDF cosine similarity over the bounded per-page keyword sets produced
 * by keyword-extraction.ts. Document frequency is computed from presence in
 * those bounded sets (an approximation of true corpus IDF, since each page
 * only contributes its top ~20 terms) — deliberately cheap enough to run
 * over an entire audit's pages in one finalize step.
 */

import { sort } from "remeda";
import type { PageKeyword } from "@/server/lib/audit/keyword-extraction";

export interface SimilarityCandidatePage {
  pageId: string;
  url: string;
  keywords: PageKeyword[];
}

export interface SimilarPagePair {
  sourcePageId: string;
  sourceUrl: string;
  targetPageId: string;
  targetUrl: string;
  score: number;
}

const DEFAULT_THRESHOLD = 0.3;
const DEFAULT_MAX_PER_PAGE = 5;

/**
 * Dense embedding cosines sit far higher than sparse TF-IDF ones — unrelated
 * pages from one site still score ~0.5 — so the embedding path needs its own
 * threshold. 0.75 keeps pairs that are genuinely about the same topic.
 */
const DEFAULT_EMBEDDING_THRESHOLD = 0.75;

export interface EmbeddedCandidatePage {
  pageId: string;
  url: string;
  vector: number[];
}

function denseCosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

/**
 * Shared pair selection: every i<j pair scoring at or above `threshold`,
 * recorded in both directions and capped at `maxPerPage` per source page.
 */
function collectPairs(
  pages: Array<{ pageId: string; url: string }>,
  score: (i: number, j: number) => number,
  threshold: number,
  maxPerPage: number,
): SimilarPagePair[] {
  const pairsBySource = new Map<string, SimilarPagePair[]>();
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const value = score(i, j);
      if (value < threshold) continue;

      for (const [from, to] of [
        [i, j],
        [j, i],
      ]) {
        const pair: SimilarPagePair = {
          sourcePageId: pages[from].pageId,
          sourceUrl: pages[from].url,
          targetPageId: pages[to].pageId,
          targetUrl: pages[to].url,
          score: value,
        };
        pairsBySource.set(pair.sourcePageId, [
          ...(pairsBySource.get(pair.sourcePageId) ?? []),
          pair,
        ]);
      }
    }
  }

  const result: SimilarPagePair[] = [];
  for (const pairs of pairsBySource.values()) {
    result.push(
      ...sort(pairs, (a, b) => b.score - a.score).slice(0, maxPerPage),
    );
  }
  return result;
}

/**
 * Same output as findSimilarPagePairs, scored on dense page embeddings instead
 * of TF-IDF. Embeddings capture topical relatedness through different wording,
 * which term overlap misses — two pages about roof repair share no vocabulary
 * if one says "toiture" and the other "couverture".
 */
export function findSimilarPagePairsFromVectors(
  pages: EmbeddedCandidatePage[],
  options: { threshold?: number; maxPerPage?: number } = {},
): SimilarPagePair[] {
  return collectPairs(
    pages,
    (i, j) => denseCosineSimilarity(pages[i].vector, pages[j].vector),
    options.threshold ?? DEFAULT_EMBEDDING_THRESHOLD,
    options.maxPerPage ?? DEFAULT_MAX_PER_PAGE,
  );
}

function toTfIdfVector(
  keywords: PageKeyword[],
  idf: Map<string, number>,
): Map<string, number> {
  const vector = new Map<string, number>();
  for (const { term, weight } of keywords) {
    vector.set(term, weight * (idf.get(term) ?? 0));
  }
  return vector;
}

function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (const value of a.values()) magnitudeA += value * value;
  for (const value of b.values()) magnitudeB += value * value;
  for (const [term, value] of a) {
    const other = b.get(term);
    if (other) dot += value * other;
  }

  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

/**
 * Every pair of pages whose TF-IDF cosine similarity clears `threshold`,
 * capped to `maxPerPage` suggestions per source page (highest score first).
 * O(n^2) in page count — fine up to a few thousand pages per audit.
 */
export function findSimilarPagePairs(
  pages: SimilarityCandidatePage[],
  options: { threshold?: number; maxPerPage?: number } = {},
): SimilarPagePair[] {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const maxPerPage = options.maxPerPage ?? DEFAULT_MAX_PER_PAGE;

  const docFrequency = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set(page.keywords.map((k) => k.term));
    for (const term of seen) {
      docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
    }
  }

  const totalPages = pages.length;
  const idf = new Map<string, number>();
  for (const [term, df] of docFrequency) {
    idf.set(term, Math.log((totalPages + 1) / (df + 1)) + 1);
  }

  const vectors = pages.map((page) => toTfIdfVector(page.keywords, idf));

  return collectPairs(
    pages,
    (i, j) => cosineSimilarity(vectors[i], vectors[j]),
    threshold,
    maxPerPage,
  );
}
