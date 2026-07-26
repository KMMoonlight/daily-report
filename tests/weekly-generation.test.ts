import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { generateWeekly } from "../src/application/generate-weekly";
import type { LanguageModel } from "../src/infrastructure/llm";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("weekly generation command", () => {
  it("synthesizes the week and removes its raw cache after publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-weekly-"));
    directories.push(root);
    const daily = join(root, "daily");
    const weekly = join(root, "weekly");
    const cache = join(root, "cache");
    const data = join(root, "data");
    await Promise.all([mkdir(daily), mkdir(weekly), mkdir(cache), mkdir(data)]);

    const report = {
      kind: "daily",
      title: "2026-07-20 科技日报",
      date: "2026-07-20",
      coverageStart: "2026-07-19T16:00:00.000Z",
      coverageEnd: "2026-07-20T15:59:59.999Z",
      items: [
        {
          id: "release-one",
          title: "Release",
          section: "products",
          topics: ["developer-tools"],
          summary: "A release.",
          analysis: "Useful.",
          publishedAt: "2026-07-20T04:00:00.000Z",
          status: "confirmed",
          fullTextRead: true,
          sources: [{ title: "Official", url: "https://example.com", kind: "primary", key: true }],
        },
      ],
    };
    await writeFile(join(daily, "2026-07-20.md"), `---\n${stringify(report)}---\n`);
    await writeFile(join(cache, "2026-07-20-collected.json"), "{}");
    await writeFile(
      join(data, "late-items.json"),
      JSON.stringify([
        {
          externalId: "late-one",
          sourceId: "media",
          title: "Late analysis",
          url: "https://example.com/late",
          publishedAt: "2026-07-21T04:00:00.000Z",
          discoveredAt: "2026-07-26T04:00:00.000Z",
          excerpt: "A late-discovered analysis.",
          sourceKind: "media",
          suggestedTopics: ["ai"],
        },
      ]),
    );

    const model: LanguageModel = {
      async triage() {
        return { include: true, section: "deep-reads", topics: ["ai"], reason: "useful" };
      },
      async synthesize() {
        return { title: "迟到但重要的分析", summary: "一篇本周文章被延迟发现。", analysis: "仍适合进入周报。" };
      },
      async weeklySynthesis() {
        return "开发者工具的发布更强调可验证成果。";
      },
    };

    const result = await generateWeekly({
      weekStart: "2026-07-20",
      dailyContentDirectory: daily,
      weeklyContentDirectory: weekly,
      cacheDirectory: cache,
      dataDirectory: data,
      model,
    });

    expect(result.itemCount).toBe(2);
    expect(await readFile(result.outputPath, "utf8")).toContain("开发者工具的发布更强调可验证成果");
    await expect(readFile(join(cache, "2026-07-20-collected.json"), "utf8")).rejects.toThrow();
    expect(JSON.parse(await readFile(join(data, "late-items.json"), "utf8"))).toEqual([]);
  });
});
