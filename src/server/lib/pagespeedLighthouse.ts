import { z } from "zod";
import {
  buildStoredLighthouseIssues,
  buildStoredLighthouseMetrics,
  lighthouseAuditSchema,
  lighthouseCategorySchema,
  type RawLighthouseAudit,
  type RawLighthouseCategory,
  scoreToPercent,
  type StoredLighthousePayload,
  summarizeZodIssues,
} from "@/server/lib/lighthouseStoredPayload";
import type { LighthouseStrategy } from "@/server/lib/dataforseoLighthousePayload";

const PAGESPEED_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

// PageSpeed Insights returns Lighthouse verbatim under `lighthouseResult`, so
// only the envelope differs from DataForSEO's.
const pagespeedResponseSchema = z.object({
  lighthouseResult: z
    .object({
      requestedUrl: z.string().optional(),
      finalUrl: z.string().optional(),
      lighthouseVersion: z.string().optional(),
      categories: z
        .record(z.string(), lighthouseCategorySchema)
        .optional()
        .default({}),
      audits: z
        .record(z.string(), lighthouseAuditSchema)
        .optional()
        .default({}),
    })
    .passthrough(),
});

export function parsePagespeedLighthousePayload(
  payload: unknown,
  input: { url: string; strategy: LighthouseStrategy },
): StoredLighthousePayload {
  const parsed = pagespeedResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `PageSpeed Insights returned an invalid response: ${summarizeZodIssues(parsed.error)}`,
    );
  }

  const result = parsed.data.lighthouseResult;
  const categories: Record<string, RawLighthouseCategory> = result.categories;
  const audits: Record<string, RawLighthouseAudit> = result.audits;
  const issueReport = buildStoredLighthouseIssues({ audits, categories });

  const storedPayload: StoredLighthousePayload = {
    version: 2,
    source: "pagespeed-insights",
    hasIssueDetails: issueReport.hasIssueDetails,
    metadata: {
      requestedUrl: result.requestedUrl ?? input.url,
      finalUrl: result.finalUrl ?? input.url,
      strategy: input.strategy,
      fetchedAt: new Date().toISOString(),
      lighthouseVersion: result.lighthouseVersion ?? null,
      // PageSpeed has no task id, and the run is free.
      taskId: null,
      cost: 0,
    },
    scores: {
      performance: scoreToPercent(categories.performance?.score),
      accessibility: scoreToPercent(categories.accessibility?.score),
      "best-practices": scoreToPercent(categories["best-practices"]?.score),
      seo: scoreToPercent(categories.seo?.score),
    },
    metrics: buildStoredLighthouseMetrics({ audits }),
    issues: issueReport.issues,
  };

  const allScoresMissing = Object.values(storedPayload.scores).every(
    (score) => score == null,
  );
  if (allScoresMissing) {
    throw new Error(
      `PageSpeed Insights returned no category scores for ${storedPayload.metadata.finalUrl}`,
    );
  }

  return storedPayload;
}

/**
 * Runs Lighthouse through Google's PageSpeed Insights API, which is free and
 * returns the same Lighthouse object DataForSEO resells. Google fetches the URL
 * from its own servers, so the page must be reachable from the public internet.
 */
export async function fetchPagespeedLighthouseResult(input: {
  url: string;
  strategy: LighthouseStrategy;
  apiKey: string;
}): Promise<StoredLighthousePayload> {
  const endpoint = new URL(PAGESPEED_ENDPOINT);
  endpoint.searchParams.set("url", input.url);
  endpoint.searchParams.set("strategy", input.strategy);
  endpoint.searchParams.set("key", input.apiKey);
  for (const category of ["performance", "accessibility", "seo"]) {
    endpoint.searchParams.append("category", category);
  }
  endpoint.searchParams.append("category", "best-practices");

  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    // Google puts the operator-actionable reason (bad key, quota, unreachable
    // URL) in the body, so surface it instead of the bare status.
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `PageSpeed Insights request failed (${response.status}): ${detail}`,
    );
  }

  return parsePagespeedLighthousePayload(await response.json(), input);
}
