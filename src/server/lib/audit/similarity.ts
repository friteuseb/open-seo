/**
 * TF-IDF cosine similarity over the bounded per-page keyword sets produced
 * by keyword-extraction.ts. Document frequency is computed from presence in
 * those bounded sets (an approximation of true corpus IDF, since each page
 * only contributes its top ~20 terms) — deliberately cheap enough to run
 * over an entire audit's pages in one finalize step.
 */
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

  const pairsBySource = new Map<string, SimilarPagePair[]>();
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const score = cosineSimilarity(vectors[i], vectors[j]);
      if (score < threshold) continue;

      const forward: SimilarPagePair = {
        sourcePageId: pages[i].pageId,
        sourceUrl: pages[i].url,
        targetPageId: pages[j].pageId,
        targetUrl: pages[j].url,
        score,
      };
      const backward: SimilarPagePair = {
        sourcePageId: pages[j].pageId,
        sourceUrl: pages[j].url,
        targetPageId: pages[i].pageId,
        targetUrl: pages[i].url,
        score,
      };

      pairsBySource.set(forward.sourcePageId, [
        ...(pairsBySource.get(forward.sourcePageId) ?? []),
        forward,
      ]);
      pairsBySource.set(backward.sourcePageId, [
        ...(pairsBySource.get(backward.sourcePageId) ?? []),
        backward,
      ]);
    }
  }

  const result: SimilarPagePair[] = [];
  for (const pairs of pairsBySource.values()) {
    result.push(
      ...pairs.toSorted((a, b) => b.score - a.score).slice(0, maxPerPage),
    );
  }
  return result;
}
