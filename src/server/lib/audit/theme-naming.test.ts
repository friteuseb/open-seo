import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nameThemeClusters, type ClusterToName } from "./theme-naming";

const mocks = vi.hoisted(() => ({ getOptionalEnvValue: vi.fn() }));

vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: mocks.getOptionalEnvValue,
}));

const clusters: ClusterToName[] = [
  {
    themeId: 1,
    keywordLabel: "tiges · noyer",
    pageTitles: ["Fraisier : culture", "Rosier : culture"],
  },
  {
    themeId: 2,
    keywordLabel: "oidium · feuilles",
    pageTitles: ["L'oïdium sur les feuilles"],
  },
];

function configured() {
  mocks.getOptionalEnvValue.mockImplementation(async (key: string) =>
    key === "EMBEDDINGS_BASE_URL"
      ? "http://model.test"
      : key === "THEME_NAMING_MODEL"
        ? "qwen3"
        : undefined,
  );
}

function answers(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content } }),
    }),
  );
}

describe("nameThemeClusters", () => {
  beforeEach(configured);
  afterEach(() => vi.unstubAllGlobals());

  it("returns the model's name for each cluster", async () => {
    answers('{"1": "Arbustes fruitiers", "2": "Maladies des feuilles"}');

    const labels = await nameThemeClusters(clusters);

    expect(labels?.get(1)).toBe("Arbustes fruitiers");
    expect(labels?.get(2)).toBe("Maladies des feuilles");
  });

  it("ignores cluster ids the audit does not have", async () => {
    answers('{"1": "Arbustes fruitiers", "99": "Inventé"}');

    const labels = await nameThemeClusters(clusters);

    expect(labels?.has(99)).toBe(false);
    expect(labels?.size).toBe(1);
  });

  it("falls back when the model answers something unparseable", async () => {
    answers("Voici les noms que je propose :");

    expect(await nameThemeClusters(clusters)).toBeNull();
  });

  it("falls back when the endpoint fails, rather than failing the audit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    expect(await nameThemeClusters(clusters)).toBeNull();
  });

  it("stays off until a deployment names a chat model", async () => {
    mocks.getOptionalEnvValue.mockImplementation(async (key: string) =>
      key === "EMBEDDINGS_BASE_URL" ? "http://model.test" : undefined,
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await nameThemeClusters(clusters)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
