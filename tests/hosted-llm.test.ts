import { describe, expect, it } from "vitest";
import { HostedLanguageModel } from "../src/infrastructure/hosted-llm";

describe("hosted language model", () => {
  it("uses separate triage and synthesis models through an OpenAI-compatible endpoint", async () => {
    const requestedModels: string[] = [];
    const model = new HostedLanguageModel(
      {
        provider: "openai-compatible",
        apiKey: "test-key",
        baseUrl: "https://llm.example/v1",
        triageModel: "fast-model",
        synthesisModel: "strong-model",
      },
      async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { model: string };
        requestedModels.push(request.model);
        const content =
          request.model === "fast-model"
            ? `{"include":true,"section":"research","topics":["ai"],"reason":"relevant"}`
            : `{"title":"标题","summary":"摘要","analysis":"分析"}`;
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
      },
    );

    const item = {
      externalId: "one",
      sourceId: "source",
      title: "Model",
      url: "https://example.com/model",
      publishedAt: "2026-07-25T00:00:00.000Z",
      discoveredAt: "2026-07-25T01:00:00.000Z",
      excerpt: "Open weights",
      sourceKind: "primary" as const,
      suggestedTopics: ["ai" as const],
    };

    const triage = await model.triage(item);
    const synthesis = await model.synthesize([item], triage);

    expect(requestedModels).toEqual(["fast-model", "strong-model"]);
    expect(synthesis.title).toBe("标题");
  });
});
