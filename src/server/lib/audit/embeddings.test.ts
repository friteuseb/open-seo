import { describe, expect, it, vi } from "vitest";
import {
  buildPageEmbeddingText,
  embedTexts,
} from "@/server/lib/audit/embeddings";

const { getOptionalEnvValueMock } = vi.hoisted(() => ({
  getOptionalEnvValueMock: vi.fn(),
}));

vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: getOptionalEnvValueMock,
}));

describe("embedTexts", () => {
  it("returns null when no endpoint is configured, so callers keep TF-IDF", async () => {
    getOptionalEnvValueMock.mockResolvedValue(undefined);

    expect(await embedTexts(["a page"])).toBeNull();
  });

  it("returns null instead of throwing when the endpoint fails", async () => {
    getOptionalEnvValueMock.mockImplementation(async (name: string) =>
      name === "EMBEDDINGS_BASE_URL" ? "http://127.0.0.1:11434" : undefined,
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("model not found", { status: 404 })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await embedTexts(["a page"])).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("falling back to TF-IDF"),
    );

    warn.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("buildPageEmbeddingText", () => {
  it("skips missing fields rather than embedding empty separators", () => {
    expect(
      buildPageEmbeddingText({
        title: "Couvreur à Lyon",
        metaDescription: null,
        contentExcerpt: null,
        keywords: [{ term: "toiture" }, { term: "zinguerie" }],
      }),
    ).toBe("Couvreur à Lyon. toiture zinguerie");
  });

  it("embeds the body text, which is what separates same-template pages", () => {
    const text = buildPageEmbeddingText({
      title: "Nénuphar : culture, plantation et entretien",
      metaDescription: null,
      contentExcerpt: "À planter en panier à 40-100 cm dans un bassin.",
      keywords: [{ term: "bassin" }],
    });

    expect(text).toContain("bassin");
    expect(text).toContain("40-100 cm");
  });
});
