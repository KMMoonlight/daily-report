import { describe, expect, it } from "vitest";
import { reportSchema } from "../src/domain/report";

const validItem = {
  id: "open-model-release",
  title: "一个开放模型发布",
  section: "research",
  topics: ["ai"],
  summary: "模型发布了可核验的权重与技术报告。",
  analysis: "这使开发者能够在受控环境中评估模型能力。",
  publishedAt: "2026-07-25T10:00:00.000Z",
  status: "confirmed",
  sources: [
    {
      title: "Official release",
      url: "https://example.com/release",
      kind: "primary",
      key: true,
    },
  ],
};

describe("report content contract", () => {
  it("accepts a daily report with a source-backed item", () => {
    const result = reportSchema.safeParse({
      kind: "daily",
      title: "2026-07-25 科技日报",
      date: "2026-07-25",
      coverageStart: "2026-07-24T16:00:00.000Z",
      coverageEnd: "2026-07-25T15:59:59.999Z",
      items: [validItem],
    });

    expect(result.success).toBe(true);
  });

  it("rejects an item without a source", () => {
    const result = reportSchema.safeParse({
      kind: "daily",
      title: "Invalid report",
      date: "2026-07-25",
      coverageStart: "2026-07-24T16:00:00.000Z",
      coverageEnd: "2026-07-25T15:59:59.999Z",
      items: [{ ...validItem, sources: [] }],
    });

    expect(result.success).toBe(false);
  });

  it("requires complete correction metadata and a key source", () => {
    const result = reportSchema.safeParse({
      kind: "daily",
      title: "Correction",
      date: "2026-07-26",
      coverageStart: "2026-07-25T16:00:00.000Z",
      coverageEnd: "2026-07-26T15:59:59.999Z",
      items: [{ ...validItem, id: "fix", section: "corrections", correctsItemId: "open-model-release" }],
    });

    expect(result.success).toBe(false);
  });
});
