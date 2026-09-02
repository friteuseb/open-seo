/**
 * Names an audit's topic clusters with a language model.
 *
 * The keyword labels from theme-clustering.ts say which words a cluster holds
 * a lot of, which is not the same as saying what it is about: a cluster of
 * plant care sheets came back as "tiges · noyer". A model reading the page
 * titles calls it "Légumes et arbustes fruitiers".
 *
 * Entirely optional. Without an endpoint, or on any failure, the caller keeps
 * the keyword labels — naming a cluster is never worth failing an audit over.
 */

import { z } from "zod";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

/** Titles sent per cluster: enough to show the pattern, short enough to stay cheap. */
const TITLES_PER_CLUSTER = 6;
const MAX_TITLE_LENGTH = 80;
const MAX_LABEL_LENGTH = 40;
/** One model call for every cluster at once, so it can keep the names distinct. */
const REQUEST_TIMEOUT_MS = 120_000;

export interface ClusterToName {
  themeId: number;
  /** The keyword label, kept as the fallback and as a hint for the model. */
  keywordLabel: string;
  pageTitles: string[];
}

const responseSchema = z.object({
  message: z.object({ content: z.string() }),
});

/**
 * Where to name clusters. Defaults to the embeddings endpoint, which is
 * already an Ollama-style server in every deployment that has one, so a
 * self-hoster gets this by setting one variable instead of two.
 */
async function getNamingConfig(): Promise<{
  baseUrl: string;
  model: string;
} | null> {
  const baseUrl =
    (await getOptionalEnvValue("THEME_NAMING_BASE_URL")) ??
    (await getOptionalEnvValue("EMBEDDINGS_BASE_URL"));
  const model = await getOptionalEnvValue("THEME_NAMING_MODEL");
  // No default model: an embeddings endpoint cannot chat, so naming stays off
  // until a deployment names a chat model explicitly.
  if (!baseUrl || !model) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), model };
}

function buildPrompt(clusters: ClusterToName[]): string {
  const groups = clusters
    .map((cluster) => {
      const titles = cluster.pageTitles
        .slice(0, TITLES_PER_CLUSTER)
        .map((title) => title.slice(0, MAX_TITLE_LENGTH))
        .join(" | ");
      return `Group ${cluster.themeId} — frequent words: ${cluster.keywordLabel}\n  page titles: ${titles}`;
    })
    .join("\n");

  return [
    "These are groups of pages from one website, produced by clustering.",
    "Give each group a short topic name (2 to 4 words) describing what its",
    "pages have in common. Write the name in the same language as the titles.",
    "No brand names, no generic words like “pages”, “articles” or “guide”.",
    "",
    groups,
    "",
    'Reply with JSON only, mapping each group number to its name: {"1": "name", "2": "name"}',
  ].join("\n");
}

/** Keeps a model's answer usable: right cluster, non-empty, short enough for a legend. */
function parseLabels(
  content: string,
  clusters: ClusterToName[],
): Map<number, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const valid = new Set(clusters.map((cluster) => cluster.themeId));
  const labels = new Map<number, string>();
  for (const [key, value] of Object.entries(parsed)) {
    const themeId = Number.parseInt(key, 10);
    if (!Number.isInteger(themeId) || !valid.has(themeId)) continue;
    if (typeof value !== "string") continue;
    const label = value.trim().slice(0, MAX_LABEL_LENGTH);
    if (label.length > 0) labels.set(themeId, label);
  }
  return labels.size > 0 ? labels : null;
}

/**
 * Returns a label per cluster id, or null when naming is not configured or the
 * model did not answer usefully. Never throws: the caller falls back to the
 * keyword labels.
 */
export async function nameThemeClusters(
  clusters: ClusterToName[],
): Promise<Map<number, string> | null> {
  if (clusters.length === 0) return null;
  const config = await getNamingConfig();
  if (!config) return null;

  try {
    const response = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: buildPrompt(clusters) }],
        stream: false,
        // Reasoning traces would land in `content` and break the JSON parse.
        think: false,
        format: "json",
        options: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) return null;

    return parseLabels(parsed.data.message.content, clusters);
  } catch {
    // Endpoint down, timed out, or answered something unparseable. The audit
    // keeps its keyword labels rather than failing over a cosmetic step.
    return null;
  }
}

/**
 * Replaces each cluster's keyword label with a model-written topic name, when
 * the deployment configured one. The keyword label describes a cluster's
 * vocabulary; a name describes its subject. Falls back silently to the labels
 * it was given.
 */
export async function withModelNamedThemes<
  T extends { pageId: string; themeId: number; themeLabel: string },
>(themes: T[], pages: Array<{ pageId: string; title: string | null }>) {
  const titlesByPage = new Map(pages.map((page) => [page.pageId, page.title]));
  const byTheme = new Map<number, ClusterToName>();

  for (const theme of themes) {
    const cluster = byTheme.get(theme.themeId) ?? {
      themeId: theme.themeId,
      keywordLabel: theme.themeLabel,
      pageTitles: [],
    };
    const title = titlesByPage.get(theme.pageId);
    // Only the first few titles are sent, so stop collecting once there are
    // enough: a 200-page cluster would otherwise build a 200-entry array.
    if (title && cluster.pageTitles.length < TITLES_PER_CLUSTER) {
      cluster.pageTitles.push(title);
    }
    byTheme.set(theme.themeId, cluster);
  }

  const named = await nameThemeClusters(Array.from(byTheme.values()));
  if (!named) return themes;

  return themes.map((theme) => ({
    ...theme,
    themeLabel: named.get(theme.themeId) ?? theme.themeLabel,
  }));
}
