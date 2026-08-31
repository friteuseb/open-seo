import { describe, expect, it } from "vitest";
import { parsePagespeedLighthousePayload } from "@/server/lib/pagespeedLighthouse";

const input = { url: "https://everyapp.dev/", strategy: "mobile" } as const;

function pagespeedResponse(
  categories: Record<string, { score: number | null }>,
) {
  return {
    lighthouseResult: {
      requestedUrl: "https://everyapp.dev/",
      finalUrl: "https://everyapp.dev/",
      lighthouseVersion: "12.2.0",
      categories,
      audits: {
        "largest-contentful-paint": {
          title: "Largest Contentful Paint",
          score: 0.42,
          displayValue: "3.1 s",
          numericValue: 3120,
        },
      },
    },
  };
}

describe("parsePagespeedLighthousePayload", () => {
  it("maps the PageSpeed envelope onto the shared stored payload", () => {
    const parsed = parsePagespeedLighthousePayload(
      pagespeedResponse({
        performance: { score: 0.54 },
        accessibility: { score: 0.93 },
        "best-practices": { score: 0.79 },
        seo: { score: 0.92 },
      }),
      input,
    );

    expect(parsed.source).toBe("pagespeed-insights");
    expect(parsed.scores).toEqual({
      performance: 54,
      accessibility: 93,
      "best-practices": 79,
      seo: 92,
    });
    expect(parsed.metrics.largestContentfulPaint.numericValue).toBe(3120);
    // The run is free and has no provider task, unlike the DataForSEO path.
    expect(parsed.metadata.cost).toBe(0);
    expect(parsed.metadata.taskId).toBeNull();
  });

  it("rejects a response where every category score is missing", () => {
    expect(() =>
      parsePagespeedLighthousePayload(
        pagespeedResponse({
          performance: { score: null },
          accessibility: { score: null },
          "best-practices": { score: null },
          seo: { score: null },
        }),
        input,
      ),
    ).toThrow(/no category scores/);
  });
});
