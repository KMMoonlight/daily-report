import { describe, expect, it } from "vitest";
import {
  clusterItems,
  eventSignatures,
  mergeDuplicateReportItems,
  normalizeCollectedItem,
  shareEventSignature,
} from "../src/application/cluster-items";
import type { ReportItem } from "../src/domain/report";

function collected(title: string, url: string, excerpt = "") {
  return normalizeCollectedItem({
    externalId: url,
    sourceId: "test",
    title,
    url,
    publishedAt: "2026-07-25T04:00:00.000Z",
    discoveredAt: "2026-07-25T05:00:00.000Z",
    excerpt,
    sourceKind: "media",
    suggestedTopics: ["ai"],
  });
}

function reportItem(title: string, summary: string, url: string): ReportItem {
  return {
    id: title,
    title,
    section: "events",
    topics: ["ai"],
    summary,
    analysis: "影响开发者选型。",
    publishedAt: "2026-07-25T04:00:00.000Z",
    status: "confirmed",
    sources: [{ title, url, kind: "media", key: true }],
  };
}

describe("event clustering", () => {
  it("recognizes Claude Opus 5 variants as one event signature", () => {
    expect(shareEventSignature("Claude Opus 5 正式发布", "Anthropic发布Claude Opus 5：性能接近 Fable 5")).toBe(
      true,
    );
    expect([...eventSignatures("Claude Opus 5发布，小鹏机器人试产")].some((value) => value.includes("claudeopus5"))).toBe(
      true,
    );
  });

  it("clusters differently worded Claude Opus 5 stories into one group", () => {
    const clusters = clusterItems([
      collected("Claude Opus 5发布，小鹏机器人试产，英伟达显卡涨价", "https://a.example/1", "Anthropic 发布 Opus 5"),
      collected(
        "Anthropic发布Claude Opus 5：性能接近Fable 5，成本仅为一半",
        "https://b.example/2",
        "Claude Opus 5 API 定价",
      ),
      collected("Claude Opus 5 正式发布", "https://c.example/3", "面向开发工具的新模型"),
      collected("Ollama v0.32.4 发布", "https://d.example/4", "Apple GPU 支持"),
    ]);

    expect(clusters).toHaveLength(2);
    const opusCluster = clusters.find((cluster) =>
      cluster.items.some((item) => item.title.includes("Opus 5")),
    );
    expect(opusCluster?.items).toHaveLength(3);
  });

  it("merges duplicate synthesized report items and keeps combined sources", () => {
    const merged = mergeDuplicateReportItems([
      reportItem("Claude Opus 5发布，小鹏机器人试产，英伟达显卡涨价", "综合三条动态。", "https://a.example/1"),
      reportItem(
        "Anthropic发布Claude Opus 5：性能接近Fable 5，成本仅为一半",
        "详细介绍 Claude Opus 5 的定价与能力，内容更完整。",
        "https://b.example/2",
      ),
      reportItem("Claude Opus 5 正式发布", "简短发布说明。", "https://c.example/3"),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources).toHaveLength(3);
    expect(merged[0]?.title).toContain("Claude Opus 5");
  });
});
