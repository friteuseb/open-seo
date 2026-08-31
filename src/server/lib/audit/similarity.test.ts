import { describe, expect, it } from "vitest";
import { findSimilarPagePairs } from "@/server/lib/audit/similarity";

function page(pageId: string, terms: string[]) {
  return {
    pageId,
    url: `https://example.com/${pageId}`,
    keywords: terms.map((term) => ({ term, weight: 3 })),
  };
}

describe("findSimilarPagePairs", () => {
  it("pairs pages that share distinctive vocabulary", () => {
    const pairs = findSimilarPagePairs([
      page("hiking-boots", ["hiking", "boots", "waterproof", "trail"]),
      page("hiking-socks", ["hiking", "socks", "waterproof", "trail"]),
      page("credit-cards", ["credit", "card", "interest", "rate"]),
    ]);

    const ids = pairs.map((pair) => [pair.sourcePageId, pair.targetPageId]);
    expect(ids).toContainEqual(["hiking-boots", "hiking-socks"]);
    expect(ids).toContainEqual(["hiking-socks", "hiking-boots"]);
    expect(
      pairs.some(
        (pair) =>
          pair.sourcePageId === "credit-cards" ||
          pair.targetPageId === "credit-cards",
      ),
    ).toBe(false);
  });

  it("returns pairs in both directions", () => {
    const pairs = findSimilarPagePairs([
      page("a", ["kayak", "paddle", "river"]),
      page("b", ["kayak", "paddle", "river"]),
    ]);

    expect(pairs.find((p) => p.sourcePageId === "a")?.targetPageId).toBe("b");
    expect(pairs.find((p) => p.sourcePageId === "b")?.targetPageId).toBe("a");
  });

  it("caps suggestions per source page", () => {
    const pages = [
      page("source", ["kayak", "paddle", "river", "gear"]),
      ...Array.from({ length: 10 }, (_, i) =>
        page(`target-${i}`, ["kayak", "paddle", "river", "gear"]),
      ),
    ];

    const pairs = findSimilarPagePairs(pages, { maxPerPage: 3 });
    const fromSource = pairs.filter((pair) => pair.sourcePageId === "source");
    expect(fromSource).toHaveLength(3);
  });

  it("returns nothing below the threshold", () => {
    const pairs = findSimilarPagePairs(
      [page("a", ["kayak"]), page("b", ["credit"])],
      { threshold: 0.3 },
    );
    expect(pairs).toEqual([]);
  });
});
