import { access, readdir, readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { stringify } from "yaml";
import { reportSchema, type Report, type ReportItem } from "../domain/report";
import type { LanguageModel } from "../infrastructure/llm";
import type { CollectedItem } from "../infrastructure/sources";
import { shanghaiDayWindow } from "./generate-daily";

interface GenerateWeeklyOptions {
  weekStart: string;
  dailyContentDirectory: string;
  weeklyContentDirectory: string;
  cacheDirectory: string;
  dataDirectory?: string;
  model: LanguageModel;
}

export interface WeeklyGenerationResult {
  outputPath: string;
  itemCount: number;
  removedCacheFiles: number;
}

export class IncompleteWeekError extends Error {
  readonly weekStart: string;
  readonly missingDates: string[];

  constructor(weekStart: string, missingDates: string[]) {
    super(`Weekly report requires 7 daily reports; missing ${missingDates.join(", ")}`);
    this.name = "IncompleteWeekError";
    this.weekStart = weekStart;
    this.missingDates = missingDates;
  }
}

function dateString(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function listWeekDates(weekStart: string) {
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart, index));
}

function isoWeek(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((value.valueOf() - yearStart.valueOf()) / 86_400_000 + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function readReports(directory: string) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".md"));
  const reports: Report[] = [];
  for (const file of files) {
    const { data } = matter(await readFile(join(directory, file), "utf8"));
    reports.push(reportSchema.parse(data));
  }
  return reports;
}

function deduplicate(items: ReportItem[]) {
  const seen = new Map<string, ReportItem>();
  for (const item of items) {
    const sourceKey = item.sources
      .map((source) => source.url)
      .sort()
      .join("|");
    const key = item.clusterId ?? sourceKey ?? item.id;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

function signalId(value: string) {
  return (
    value
      .normalize("NFKD")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `weekly-signal-${crypto.randomUUID().slice(0, 8)}`
  );
}

export async function generateWeekly(options: GenerateWeeklyOptions): Promise<WeeklyGenerationResult> {
  await mkdir(options.weeklyContentDirectory, { recursive: true });
  const outputPath = join(options.weeklyContentDirectory, `${isoWeek(options.weekStart)}.md`);
  try {
    await access(outputPath);
    throw new Error(`Refusing to overwrite immutable weekly report: ${outputPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const start = shanghaiDayWindow(options.weekStart).start;
  const end = new Date(start.valueOf() + 7 * 86_400_000 - 1);
  const publishDate = dateString(new Date(end.valueOf() + 1));
  const reports = await readReports(options.dailyContentDirectory);
  const availableDates = new Set(reports.map((report) => report.date));
  const missingDates = listWeekDates(options.weekStart).filter((date) => !availableDates.has(date));
  if (missingDates.length > 0) {
    throw new IncompleteWeekError(options.weekStart, missingDates);
  }
  const selectedReports = reports.filter((report) => {
    const reportDate = new Date(`${report.date}T00:00:00+08:00`).valueOf();
    return reportDate >= start.valueOf() && reportDate <= end.valueOf();
  });
  const dailyItems = deduplicate(selectedReports.flatMap((report) => report.items));
  let lateItems: CollectedItem[] = [];
  const lateItemsPath = options.dataDirectory ? join(options.dataDirectory, "late-items.json") : undefined;
  if (lateItemsPath) {
    try {
      lateItems = JSON.parse(await readFile(lateItemsPath, "utf8")) as CollectedItem[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const existingUrls = new Set(dailyItems.flatMap((item) => item.sources.map((source) => source.url)));
  const lateItemsInWeek = lateItems.filter((item) => {
    const publishedAt = new Date(item.publishedAt).valueOf();
    return publishedAt >= start.valueOf() && publishedAt <= end.valueOf() && !existingUrls.has(item.url);
  });
  const synthesizedLateItems: ReportItem[] = [];
  for (const lateItem of lateItemsInWeek) {
    try {
      const triage = await options.model.triage(lateItem);
      if (!triage.include) continue;
      const unverifiedHighImpact = triage.impact === "high" && lateItem.sourceKind !== "primary";
      const effectiveTriage = triage;
      const synthesis = await options.model.synthesize([lateItem], effectiveTriage);
      synthesizedLateItems.push(
        reportSchema.shape.items.element.parse({
          id: signalId(`late-${lateItem.externalId}-${synthesis.title}`),
          title: synthesis.title,
          section: effectiveTriage.section,
          topics: effectiveTriage.topics,
          summary: synthesis.summary,
          analysis: synthesis.analysis,
          ...(effectiveTriage.section === "products" && lateItem.imageUrl
            ? { imageUrl: lateItem.imageUrl, imageAlt: lateItem.imageAlt ?? `${synthesis.title} 产品截图` }
            : {}),
          publishedAt: lateItem.publishedAt,
          status: unverifiedHighImpact ? "unconfirmed" : "confirmed",
          fullTextRead: lateItem.fullTextRead !== false,
          sources: [
            {
              title: lateItem.title,
              url: lateItem.url,
              kind: lateItem.sourceKind,
              key: true,
            },
          ],
        }),
      );
    } catch {
      // A failed late item is omitted without blocking valid weekly content.
    }
  }
  const items = deduplicate([...dailyItems, ...synthesizedLateItems]);
  const trendSummary = await options.model.weeklySynthesis(
    items.map(({ title, summary, analysis }) => ({ title, summary, analysis })),
  );

  const report = reportSchema.parse({
    kind: "weekly",
    title: `${isoWeek(options.weekStart)} 科技周报`,
    date: publishDate,
    coverageStart: start.toISOString(),
    coverageEnd: end.toISOString(),
    trendSummary,
    items,
  });

  await writeFile(outputPath, `---\n${stringify(report).trimEnd()}\n---\n\n本周报由一周信息簇综合生成。\n`, {
    flag: "wx",
  });
  if (lateItemsPath) {
    const retainedLateItems = lateItems.filter((item) => {
      const publishedAt = new Date(item.publishedAt).valueOf();
      return publishedAt < start.valueOf() || publishedAt > end.valueOf();
    });
    await writeFile(lateItemsPath, JSON.stringify(retainedLateItems, null, 2));
  }

  let removedCacheFiles = 0;
  const cacheFiles = await readdir(options.cacheDirectory).catch(() => []);
  for (const file of cacheFiles) {
    const match = file.match(/^(\d{4}-\d{2}-\d{2})-collected\.json$/);
    if (!match?.[1]) continue;
    const fileDate = new Date(`${match[1]}T00:00:00+08:00`).valueOf();
    if (fileDate >= start.valueOf() && fileDate <= end.valueOf()) {
      await unlink(join(options.cacheDirectory, file));
      removedCacheFiles += 1;
    }
  }

  return { outputPath, itemCount: items.length, removedCacheFiles };
}
