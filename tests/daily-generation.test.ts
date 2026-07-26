import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateDaily } from "../src/application/generate-daily";
import type { LanguageModel } from "../src/infrastructure/llm";
import type { SourceAdapter } from "../src/infrastructure/sources";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("daily generation command", () => {
  it("turns a source item into a validated daily Markdown report", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-daily-"));
    temporaryDirectories.push(root);

    const source: SourceAdapter = {
      id: "official-feed",
      async collect() {
        return [
          {
            externalId: "release-1",
            sourceId: "official-feed",
            title: "Open model release",
            url: "https://example.com/release",
            publishedAt: "2026-07-25T04:00:00.000Z",
            discoveredAt: "2026-07-26T00:00:00.000Z",
            excerpt: "Weights and evaluation code are available.",
            sourceKind: "primary",
            suggestedTopics: ["ai"],
          },
        ];
      },
    };

    const model: LanguageModel = {
      async triage() {
        return { include: true, section: "research", topics: ["ai"], reason: "可复现的模型发布" };
      },
      async synthesize() {
        return {
          title: "开放模型发布权重与评估代码",
          summary: "新模型同时开放权重和评估代码。",
          analysis: "开发者可以在自己的工作负载上复现实验。",
        };
      },
      async weeklySynthesis() {
        return "本周开放模型强调可复现性。";
      },
    };

    const result = await generateDaily({
      date: "2026-07-25",
      adapters: [source],
      model,
      contentDirectory: join(root, "content"),
      cacheDirectory: join(root, "cache"),
      dataDirectory: join(root, "data"),
      now: new Date("2026-07-26T01:00:00.000Z"),
    });

    expect(result.publishedItems).toBe(1);
    const markdown = await readFile(join(root, "content", "2026-07-25.md"), "utf8");
    expect(markdown).toContain("kind: daily");
    expect(markdown).toContain("开放模型发布权重与评估代码");
    expect(markdown).toContain("https://example.com/release");
  });

  it("quarantines a source whose volume is far above its baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-daily-"));
    temporaryDirectories.push(root);
    const dataDirectory = join(root, "data");
    await mkdir(dataDirectory);
    await writeFile(
      join(dataDirectory, "source-volumes.json"),
      JSON.stringify({ noisy: { samples: [2, 3, 2], quarantinedAt: null } }),
    );
    const source: SourceAdapter = {
      id: "noisy",
      async collect() {
        return Array.from({ length: 60 }, (_, index) => ({
          externalId: String(index),
          sourceId: "noisy",
          title: `Item ${index}`,
          url: `https://example.com/${index}`,
          publishedAt: "2026-07-25T04:00:00.000Z",
          discoveredAt: "2026-07-26T00:00:00.000Z",
          excerpt: "Unexpected volume",
          sourceKind: "media" as const,
          suggestedTopics: ["tech-radar" as const],
        }));
      },
    };
    const model: LanguageModel = {
      async triage() {
        throw new Error("quarantined items must not reach the model");
      },
      async synthesize() {
        throw new Error("not used");
      },
      async weeklySynthesis() {
        throw new Error("not used");
      },
    };

    const result = await generateDaily({
      date: "2026-07-25",
      adapters: [source],
      model,
      contentDirectory: join(root, "content"),
      cacheDirectory: join(root, "cache"),
      dataDirectory,
    });

    expect(result.publishedItems).toBe(0);
    expect(result.sourceErrors[0]).toMatch(/quarantined/i);
  });

  it("downgrades a high-impact single-source claim to an unconfirmed radar item", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-daily-"));
    temporaryDirectories.push(root);
    const source: SourceAdapter = {
      id: "media",
      async collect() {
        return [
          {
            externalId: "rumor",
            sourceId: "media",
            title: "Large acquisition",
            url: "https://example.com/rumor",
            publishedAt: "2026-07-25T04:00:00.000Z",
            discoveredAt: "2026-07-25T05:00:00.000Z",
            excerpt: "One publication reports a large acquisition.",
            sourceKind: "media",
            suggestedTopics: ["ai"],
          },
        ];
      },
    };
    const model: LanguageModel = {
      async triage() {
        return { include: true, section: "events", topics: ["ai"], reason: "high impact", impact: "high" };
      },
      async synthesize() {
        return { title: "一项尚未确认的收购消息", summary: "单一媒体报告了交易。", analysis: "尚待独立来源确认。" };
      },
      async weeklySynthesis() {
        return "";
      },
    };

    await generateDaily({
      date: "2026-07-25",
      adapters: [source],
      model,
      contentDirectory: join(root, "content"),
      cacheDirectory: join(root, "cache"),
      dataDirectory: join(root, "data"),
    });
    const markdown = await readFile(join(root, "content", "2026-07-25.md"), "utf8");

    expect(markdown).toContain("section: radar");
    expect(markdown).toContain("status: unconfirmed");
  });

  it("links a later update to the previous item in the same developing story", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-daily-"));
    temporaryDirectories.push(root);
    let externalId = "day-one";
    let publishedAt = "2026-07-25T04:00:00.000Z";
    const source: SourceAdapter = {
      id: "official",
      async collect() {
        return [
          {
            externalId,
            sourceId: "official",
            title: "Agent protocol release",
            url: `https://example.com/${externalId}`,
            publishedAt,
            discoveredAt: publishedAt,
            excerpt: "Update",
            sourceKind: "primary",
            suggestedTopics: ["developer-tools"],
          },
        ];
      },
    };
    const model: LanguageModel = {
      async triage() {
        return { include: true, section: "products", topics: ["developer-tools"], reason: "update" };
      },
      async synthesize(items) {
        return { title: items[0]!.title, summary: "新增变化。", analysis: "影响。" };
      },
      async weeklySynthesis() {
        return "";
      },
    };
    const shared = {
      adapters: [source],
      model,
      contentDirectory: join(root, "content"),
      cacheDirectory: join(root, "cache"),
      dataDirectory: join(root, "data"),
    };

    await generateDaily({ ...shared, date: "2026-07-25" });
    externalId = "day-two";
    publishedAt = "2026-07-26T04:00:00.000Z";
    await generateDaily({ ...shared, date: "2026-07-26" });
    const markdown = await readFile(join(root, "content", "2026-07-26.md"), "utf8");

    expect(markdown).toContain("previousItemId: day-one-agent-protocol-release");
    expect(markdown).toContain("storyId:");
  });
});
