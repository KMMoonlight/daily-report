import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { generateWeekly, IncompleteWeekError, listWeekDates } from "../src/application/generate-weekly";
import { runScheduledGeneration } from "../src/application/scheduler";
import type { LanguageModel } from "../src/infrastructure/llm";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function dailyReport(date: string) {
  return {
    kind: "daily",
    title: `${date} 科技日报`,
    date,
    coverageStart: "2026-07-19T16:00:00.000Z",
    coverageEnd: "2026-07-26T15:59:59.999Z",
    items: [
      {
        id: `item-${date}`,
        title: `Update ${date}`,
        section: "products",
        topics: ["developer-tools"],
        summary: "A release with concrete capability changes.",
        analysis: "Useful for developers evaluating the tool.",
        publishedAt: `${date}T04:00:00.000Z`,
        status: "confirmed",
        fullTextRead: true,
        sources: [{ title: "Official", url: `https://example.com/${date}`, kind: "primary", key: true }],
      },
    ],
  };
}

describe("weekly generation command", () => {
  it("requires all seven daily reports before synthesizing a week", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-weekly-"));
    directories.push(root);
    const daily = join(root, "daily");
    await mkdir(daily);
    await writeFile(join(daily, "2026-07-20.md"), `---\n${stringify(dailyReport("2026-07-20"))}---\n`);

    await expect(
      generateWeekly({
        weekStart: "2026-07-20",
        dailyContentDirectory: daily,
        weeklyContentDirectory: join(root, "weekly"),
        cacheDirectory: join(root, "cache"),
        model: {
          async triage() {
            return { include: true, section: "products", topics: ["developer-tools"], reason: "x" };
          },
          async synthesize() {
            return { title: "t", summary: "s", analysis: "a" };
          },
          async weeklySynthesis() {
            return "trend";
          },
        },
      }),
    ).rejects.toBeInstanceOf(IncompleteWeekError);
  });

  it("synthesizes the week and removes its raw cache after publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-weekly-"));
    directories.push(root);
    const daily = join(root, "daily");
    const weekly = join(root, "weekly");
    const cache = join(root, "cache");
    const data = join(root, "data");
    await Promise.all([mkdir(daily), mkdir(weekly), mkdir(cache), mkdir(data)]);

    for (const date of listWeekDates("2026-07-20")) {
      await writeFile(join(daily, `${date}.md`), `---\n${stringify(dailyReport(date))}---\n`);
      await writeFile(join(cache, `${date}-collected.json`), "{}");
    }
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

    expect(result.itemCount).toBeGreaterThanOrEqual(7);
    expect(await readFile(result.outputPath, "utf8")).toContain("开发者工具的发布更强调可验证成果");
    await expect(readFile(join(cache, "2026-07-20-collected.json"), "utf8")).rejects.toThrow();
    expect(JSON.parse(await readFile(join(data, "late-items.json"), "utf8"))).toEqual([]);
  });

  it("skips weekly scheduling when the previous week is incomplete", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-scheduler-weekly-"));
    directories.push(root);
    let weeklyCalls = 0;
    const { IncompleteWeekError: ErrorType } = await import("../src/application/generate-weekly");

    const result = await runScheduledGeneration({
      now: new Date("2026-07-27T02:30:00.000Z"), // Monday 10:30 Asia/Shanghai
      startDate: "2026-07-27",
      ledgerPath: join(root, "ledger.json"),
      logPath: join(root, "run.jsonl"),
      async generateDaily() {},
      async generateWeekly() {
        weeklyCalls += 1;
        throw new ErrorType("2026-07-20", ["2026-07-21", "2026-07-22"]);
      },
    });

    expect(weeklyCalls).toBe(1);
    expect(result.completedWeeks).toEqual([]);
    expect(result.failedWeek).toBeUndefined();
    const ledger = JSON.parse(await readFile(join(root, "ledger.json"), "utf8"));
    expect(ledger.successfulWeeks).toEqual([]);
    expect(await readFile(join(root, "run.jsonl"), "utf8")).toContain("weekly-skipped-incomplete");
  });
});
