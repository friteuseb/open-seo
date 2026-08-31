import { describe, expect, it } from "vitest";
import { computeLinkGraphMetrics } from "@/server/lib/audit/link-graph-metrics";

describe("computeLinkGraphMetrics", () => {
  it("counts inbound/outbound links per page", () => {
    const { pageMetrics } = computeLinkGraphMetrics(
      ["a", "b", "c"],
      [
        { sourcePageId: "a", targetPageId: "b" },
        { sourcePageId: "a", targetPageId: "c" },
        { sourcePageId: "b", targetPageId: "c" },
      ],
    );

    const byId = new Map(pageMetrics.map((page) => [page.pageId, page]));
    expect(byId.get("a")).toMatchObject({
      inboundLinkCount: 0,
      outboundLinkCount: 2,
    });
    expect(byId.get("c")).toMatchObject({
      inboundLinkCount: 2,
      outboundLinkCount: 0,
    });
  });

  it("ranks a page linked from every other page highest", () => {
    const { pageMetrics } = computeLinkGraphMetrics(
      ["hub", "a", "b", "c"],
      [
        { sourcePageId: "a", targetPageId: "hub" },
        { sourcePageId: "b", targetPageId: "hub" },
        { sourcePageId: "c", targetPageId: "hub" },
      ],
    );

    const byId = new Map(pageMetrics.map((page) => [page.pageId, page]));
    const hubRank = byId.get("hub")?.pagerank ?? 0;
    for (const id of ["a", "b", "c"]) {
      expect(hubRank).toBeGreaterThan(byId.get(id)?.pagerank ?? 0);
    }
  });

  it("counts pages with zero inbound links as orphaned", () => {
    const { stats } = computeLinkGraphMetrics(
      ["a", "b", "c"],
      [{ sourcePageId: "a", targetPageId: "b" }],
    );

    expect(stats.orphanedPages).toBe(2); // a and c
    expect(stats.totalLinks).toBe(1);
  });

  it("handles a graph with no edges without dividing by zero", () => {
    const { stats, pageMetrics } = computeLinkGraphMetrics(["a", "b"], []);

    expect(stats.networkDensity).toBe(0);
    expect(stats.avgLinksPerPage).toBe(0);
    expect(pageMetrics.every((page) => page.centralityScore === 0)).toBe(true);
  });

  it("handles an empty graph", () => {
    const { stats, pageMetrics } = computeLinkGraphMetrics([], []);

    expect(pageMetrics).toEqual([]);
    expect(stats.totalPages).toBe(0);
    expect(stats.networkDensity).toBe(0);
  });
});
