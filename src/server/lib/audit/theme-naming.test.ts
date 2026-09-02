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

/** Records what the module asked for, typed at the boundary rather than cast after. */
function answers(content: string) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const stub = (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    });
  };
  vi.stubGlobal("fetch", vi.fn(stub));
  return calls;
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

  it("calls the OpenAI chat-completions route, which Ollama also serves", async () => {
    const calls = answers('{"1": "Arbustes"}');

    await nameThemeClusters(clusters);

    expect(calls[0].url).toBe("http://model.test/v1/chat/completions");
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it("falls back to the instance's OpenRouter key when no local model is set", async () => {
    // A hosted deployment configures neither embeddings nor a naming endpoint,
    // but already has a key for its chat agents.
    mocks.getOptionalEnvValue.mockImplementation(async (key: string) =>
      key === "OPENROUTER_API_KEY" ? "sk-test" : undefined,
    );
    const calls = answers('{"1": "Fruit trees"}');

    const labels = await nameThemeClusters(clusters);

    expect(labels?.get(1)).toBe("Fruit trees");
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].headers.authorization).toBe("Bearer sk-test");
  });

  it("names in batches, so one slow answer cannot lose every label", async () => {
    const many: ClusterToName[] = Array.from({ length: 14 }, (_, n) => ({
      themeId: n,
      keywordLabel: `mot${n}`,
      pageTitles: [`Titre ${n}`],
    }));
    const calls = answers('{"0": "Un nom"}');

    await nameThemeClusters(many);

    // 14 clusters at 10 per call.
    expect(calls).toHaveLength(2);
  });

  it("stays off when nothing at all is configured", async () => {
    mocks.getOptionalEnvValue.mockResolvedValue(undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await nameThemeClusters(clusters)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
