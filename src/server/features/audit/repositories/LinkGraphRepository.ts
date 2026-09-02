/**
 * Data access for internal-linking graph metrics and similarity keywords —
 * split out of AuditRepository to keep both files under the line budget.
 * Still operates on the shared `audit_pages` table; link edges themselves
 * live in the per-audit scratchpad Durable Object.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditPages } from "@/db/schema";
import { executeInBatches } from "@/db/runBatch";
import type { PageKeyword } from "@/server/lib/audit/keyword-extraction";

function isPageKeyword(value: unknown): value is PageKeyword {
  if (!value || typeof value !== "object") return false;
  return (
    "term" in value &&
    "weight" in value &&
    typeof value.term === "string" &&
    typeof value.weight === "number"
  );
}

function toUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseKeywords(json: string | null): PageKeyword[] {
  if (!json) return [];
  return toUnknownArray(JSON.parse(json)).filter(isPageKeyword);
}

/** Bounded per-page keyword sets for the internal-linking similarity pass. */
async function getPagesForSimilarity(auditId: string) {
  const rows = await db
    .select({
      id: auditPages.id,
      url: auditPages.url,
      keywordsJson: auditPages.keywordsJson,
      title: auditPages.title,
      metaDescription: auditPages.metaDescription,
    })
    .from(auditPages)
    .where(eq(auditPages.auditId, auditId));

  return rows.map((row) => ({
    pageId: row.id,
    url: row.url,
    keywords: parseKeywords(row.keywordsJson),
    title: row.title,
    metaDescription: row.metaDescription,
  }));
}

/** Persist internal-link graph metrics computed at finalize (see AuditScratchpad.computeLinkGraphAnalysis). */
async function updateLinkGraphMetrics(
  auditId: string,
  pageMetrics: Array<{
    pageId: string;
    pagerank: number;
    centralityScore: number;
    inboundLinkCount: number;
  }>,
) {
  await executeInBatches(pageMetrics, (tx, metrics) =>
    tx
      .update(auditPages)
      .set({
        pagerank: metrics.pagerank,
        centralityScore: metrics.centralityScore,
        inboundLinkCount: metrics.inboundLinkCount,
      })
      .where(
        and(eq(auditPages.auditId, auditId), eq(auditPages.id, metrics.pageId)),
      ),
  );
}

/** Persist the topical clusters computed at finalize (see theme-clustering.ts). */
async function updatePageThemes(
  auditId: string,
  themes: Array<{ pageId: string; themeId: number; themeLabel: string }>,
) {
  await executeInBatches(themes, (tx, theme) =>
    tx
      .update(auditPages)
      .set({ themeId: theme.themeId, themeLabel: theme.themeLabel })
      .where(
        and(eq(auditPages.auditId, auditId), eq(auditPages.id, theme.pageId)),
      ),
  );
}

export const LinkGraphRepository = {
  getPagesForSimilarity,
  updateLinkGraphMetrics,
  updatePageThemes,
} as const;
