import { describe, expect, it } from "vitest";
import { extractPageKeywords } from "@/server/lib/audit/keyword-extraction";

describe("extractPageKeywords", () => {
  it("weights repeated terms higher when the field weight is higher", () => {
    const keywords = extractPageKeywords([
      { text: "hiking boots hiking boots hiking boots", weight: 3 },
      { text: "great hiking gear for the trail", weight: 1 },
    ]);

    const terms = keywords.map((k) => k.term);
    expect(terms[0]).toBe("hiking");
  });

  it("drops stopwords and short terms", () => {
    const keywords = extractPageKeywords([
      { text: "the and for with waterproof waterproof", weight: 1 },
    ]);

    const terms = keywords.map((k) => k.term);
    expect(terms).toContain("waterproof");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("and");
  });

  it("drops terms that only occur once", () => {
    const keywords = extractPageKeywords([
      { text: "unique singleton waterproof waterproof", weight: 1 },
    ]);

    const terms = keywords.map((k) => k.term);
    expect(terms).toContain("waterproof");
    expect(terms).not.toContain("unique");
  });

  it("caps the result at 20 terms", () => {
    const words = Array.from({ length: 40 }, (_, i) => `term${i} term${i}`);
    const keywords = extractPageKeywords([
      { text: words.join(" "), weight: 1 },
    ]);

    expect(keywords.length).toBeLessThanOrEqual(20);
  });

  it("handles empty fields", () => {
    expect(extractPageKeywords([{ text: "", weight: 3 }])).toEqual([]);
    expect(extractPageKeywords([])).toEqual([]);
  });
});
