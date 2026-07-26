import { describe, expect, it } from "vitest";
import { HostedLanguageModel } from "../src/infrastructure/hosted-llm";

describe("hosted language model", () => {
  it("uses separate triage and synthesis models through an OpenAI-compatible endpoint", async () => {
    const requestedModels: string[] = [];
    const requestedPrompts: string[] = [];
    const model = new HostedLanguageModel(
      {
        provider: "openai-compatible",
        apiKey: "test-key",
        baseUrl: "https://llm.example/v1",
        triageModel: "fast-model",
        synthesisModel: "strong-model",
      },
      async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as {
          model: string;
          messages: Array<{ content: string }>;
        };
        requestedModels.push(request.model);
        requestedPrompts.push(request.messages[0]?.content ?? "");
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
    expect(requestedPrompts[1]).toContain("summary 与 analysis 会合并成一段正文展示");
    expect(requestedPrompts[1]).toContain("不能写点赞数、评论数、Hacker News/Reddit 分数");
  });

  it("maps model-invented topics instead of rejecting the whole item", async () => {
    const model = new HostedLanguageModel(
      {
        provider: "openai-compatible",
        apiKey: "test-key",
        baseUrl: "https://llm.example/v1",
        triageModel: "fast-model",
        synthesisModel: "strong-model",
      },
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    `{"include":true,"section":"deep-reads","topics":["networking","programming"],` +
                    `"reason":"relevant","impact":"medium"}`,
                },
              },
            ],
          }),
        ),
    );

    const triage = await model.triage({
      externalId: "networking",
      sourceId: "cloudflare",
      title: "BGP origin manipulation",
      url: "https://example.com/bgp",
      publishedAt: "2026-07-25T00:00:00.000Z",
      discoveredAt: "2026-07-25T01:00:00.000Z",
      excerpt: "Internet routing analysis",
      sourceKind: "primary",
      suggestedTopics: ["developer-tools"],
    });

    expect(triage.topics).toEqual(["developer-tools"]);
  });

  it("falls back to source topics when the model omits topics", async () => {
    const model = new HostedLanguageModel(
      {
        provider: "openai-compatible",
        apiKey: "test-key",
        baseUrl: "https://llm.example/v1",
        triageModel: "fast-model",
        synthesisModel: "strong-model",
      },
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    `{"include":true,"section":"events","reason":"relevant","impact":"medium"}`,
                },
              },
            ],
          }),
        ),
    );

    const triage = await model.triage({
      externalId: "release",
      sourceId: "github",
      title: "Framework release",
      url: "https://example.com/release",
      publishedAt: "2026-07-25T00:00:00.000Z",
      discoveredAt: "2026-07-25T01:00:00.000Z",
      excerpt: "A new release",
      sourceKind: "primary",
      suggestedTopics: ["developer-tools"],
    });

    expect(triage.topics).toEqual(["developer-tools"]);
  });
});
