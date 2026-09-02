import { z } from "zod";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

const DEFAULT_MODEL = "nomic-embed-text";
/** One request per batch; large enough to amortise round-trips, small enough
 * to keep a single request's body and the server's memory bounded. */
const BATCH_SIZE = 32;

const embedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())),
});

/**
 * Where to compute page embeddings, when the deployment provides an
 * OpenAI/Ollama-style embedding endpoint. Absent means the caller keeps its
 * existing TF-IDF path — embeddings are an upgrade, never a requirement.
 */
async function getEmbeddingsConfig(): Promise<{
  baseUrl: string;
  model: string;
} | null> {
  const baseUrl = await getOptionalEnvValue("EMBEDDINGS_BASE_URL");
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    model: (await getOptionalEnvValue("EMBEDDINGS_MODEL")) ?? DEFAULT_MODEL,
  };
}

async function embedBatch(
  texts: string[],
  config: { baseUrl: string; model: string },
): Promise<number[][]> {
  const response = await fetch(`${config.baseUrl}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.model, input: texts }),
  });

  if (!response.ok) {
    throw new Error(
      `Embedding request failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  }

  const parsed = embedResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Embedding endpoint returned an unexpected response shape");
  }
  if (parsed.data.embeddings.length !== texts.length) {
    throw new Error(
      `Embedding endpoint returned ${parsed.data.embeddings.length} vectors for ${texts.length} inputs`,
    );
  }
  return parsed.data.embeddings;
}

/**
 * Embeds every text in order, in batches. Returns null when no endpoint is
 * configured or the endpoint fails, so callers fall back rather than losing the
 * whole analysis to an embedding outage.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const config = await getEmbeddingsConfig();
  if (!config || texts.length === 0) return null;

  try {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      vectors.push(
        ...(await embedBatch(texts.slice(i, i + BATCH_SIZE), config)),
      );
    }
    return vectors;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[embeddings] falling back to TF-IDF similarity: ${message}`);
    return null;
  }
}

/**
 * The text an embedding sees for a page: its title and meta description (the
 * page's own summary of itself) plus the salient body terms already extracted
 * during the crawl, so the vector reflects the content and not just the head.
 */
export function buildPageEmbeddingText(page: {
  title: string | null;
  metaDescription: string | null;
  contentExcerpt: string | null;
  keywords: Array<{ term: string }>;
}): string {
  // The body carries the topic; title and meta often only carry the template.
  // On a site whose sheets are all "X: sowing and care", two pages differ in
  // their body text long before they differ in their title.
  return [
    page.title ?? "",
    page.metaDescription ?? "",
    page.contentExcerpt ?? "",
    page.keywords.map((keyword) => keyword.term).join(" "),
  ]
    .filter((part) => part.trim() !== "")
    .join(". ");
}
