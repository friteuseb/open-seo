import { describe, expect, it } from "vitest";
import {
  assignPageThemes,
  chooseClusterCount,
  type ClusterablePage,
} from "./theme-clustering";

function page(
  pageId: string,
  keywords: Array<[string, number]>,
): ClusterablePage {
  return {
    pageId,
    keywords: keywords.map(([term, weight]) => ({ term, weight })),
  };
}

describe("chooseClusterCount", () => {
  it("never asks for more clusters than there are pages", () => {
    expect(chooseClusterCount(0)).toBe(0);
    expect(chooseClusterCount(1)).toBe(1);
  });

  it("stays within the legend's readable range as a site grows", () => {
    expect(chooseClusterCount(60)).toBe(2);
    expect(chooseClusterCount(240)).toBe(8);
    expect(chooseClusterCount(600)).toBe(10);
    expect(chooseClusterCount(100_000)).toBe(10);
  });
});

describe("assignPageThemes with embeddings", () => {
  // Two clearly separated directions in a 3-D space stand in for two topics.
  const gardening = [1, 0, 0];
  const legal = [0, 1, 0];

  const pages = [
    page("p1", [["tomates", 5]]),
    page("p2", [["semis", 4]]),
    page("p3", [["mentions", 5]]),
    page("p4", [["cookies", 4]]),
  ];
  const vectors = [
    [1, 0.05, 0],
    [0.98, 0, 0.02],
    [0.02, 1, 0],
    [0, 0.97, 0.03],
  ];

  it("groups pages by vector direction, not by shared words", () => {
    const themes = assignPageThemes(pages, vectors);
    const themeOf = new Map(themes.map((t) => [t.pageId, t.themeId]));

    expect(themeOf.get("p1")).toBe(themeOf.get("p2"));
    expect(themeOf.get("p3")).toBe(themeOf.get("p4"));
    expect(themeOf.get("p1")).not.toBe(themeOf.get("p3"));
  });

  it("names each cluster after its own distinctive terms", () => {
    const themes = assignPageThemes(pages, vectors);
    const labelOf = new Map(themes.map((t) => [t.pageId, t.themeLabel]));

    expect(labelOf.get("p1")).toMatch(/tomates|semis/);
    expect(labelOf.get("p3")).toMatch(/mentions|cookies/);
    expect(labelOf.get("p1")).not.toBe(labelOf.get("p3"));
  });

  it("is deterministic, so re-running an audit keeps the colours", () => {
    const first = assignPageThemes(pages, vectors);
    const second = assignPageThemes(pages, vectors);
    expect(second).toEqual(first);
  });

  it("ignores vectors that do not line up with the pages", () => {
    const themes = assignPageThemes(pages, [gardening, legal]);
    // Falls back to keywords rather than mis-assigning by index.
    expect(themes).toHaveLength(pages.length);
    expect(new Set(themes.map((t) => t.themeId)).size).toBeGreaterThan(0);
  });
});

describe("assignPageThemes without embeddings", () => {
  it("falls back to the dominant keyword so themes still exist", () => {
    const pages = [
      page("p1", [
        ["tomates", 9],
        ["potager", 2],
      ]),
      page("p2", [
        ["tomates", 8],
        ["arrosage", 3],
      ]),
      page("p3", [
        ["mentions", 7],
        ["legales", 4],
      ]),
    ];

    const themes = assignPageThemes(pages, null);
    const themeOf = new Map(themes.map((t) => [t.pageId, t.themeId]));

    expect(themeOf.get("p1")).toBe(themeOf.get("p2"));
    expect(themeOf.get("p1")).not.toBe(themeOf.get("p3"));
    expect(themes.every((t) => t.themeLabel.length > 0)).toBe(true);
  });

  it("does not name a cluster after the site's own vocabulary", () => {
    // "papy" is the brand: on every page, so on far more than
    // MAX_DOCUMENT_RATIO of them, while each subject sits on a third.
    const subjects = ["tomates", "mentions", "semis"];
    const pages = subjects.flatMap((subject, group) =>
      [0, 1, 2].map((n) =>
        page(`p${group}${n}`, [
          [subject, 9],
          ["papy", 5],
        ]),
      ),
    );

    const labels = assignPageThemes(pages, null).map((t) => t.themeLabel);

    expect(labels.every((label) => !label.includes("papy"))).toBe(true);
    expect(labels.join(" ")).toMatch(/tomates|mentions|semis/);
  });

  it("does not spend both label slots on one word's singular and plural", () => {
    const pages = [
      page("p1", [
        ["tomates", 9],
        ["tomate", 8],
        ["semis", 6],
      ]),
      page("p2", [
        ["tomates", 9],
        ["tomate", 7],
        ["semis", 5],
      ]),
    ];

    const label = assignPageThemes(pages, null)[0].themeLabel;

    expect(label).toContain("tomate");
    expect(label).toContain("semis");
  });

  it("returns nothing for an audit with no pages", () => {
    expect(assignPageThemes([], null)).toEqual([]);
  });

  it("labels a cluster even when its pages carry no keywords", () => {
    const themes = assignPageThemes([page("p1", []), page("p2", [])], null);
    expect(themes).toHaveLength(2);
    expect(themes.every((t) => t.themeLabel.length > 0)).toBe(true);
  });
});
