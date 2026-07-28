import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { dailyEditionDate, reportSchema, type Report, type ReportItem } from "../domain/report";
import type { LanguageModel } from "../infrastructure/llm";
import type { CollectedItem, SourceAdapter } from "../infrastructure/sources";
import {
  clusterItems,
  mergeDuplicateReportItems,
  normalizeCollectedItem,
  normalizeTitle,
} from "./cluster-items";
import { isHollowReportCopy, isHollowTrendingCandidate } from "../presentation/substance";

interface GenerateDailyOptions {
  date: string;
  adapters: SourceAdapter[];
  model: LanguageModel;
  contentDirectory: string;
  cacheDirectory: string;
  dataDirectory: string;
  now?: Date;
}

export interface DailyGenerationResult {
  date: string;
  publishedItems: number;
  candidateItems: number;
  failedItems: number;
  sourceErrors: string[];
  outputPath: string;
}

interface SourceVolumeState {
  [sourceId: string]: {
    samples: number[];
    quarantinedAt: string | null;
  };
}

interface StoryState {
  [clusterKey: string]: {
    storyId: string;
    lastItemId: string;
    lastDate: string;
  };
}

const dayInMilliseconds = 86_400_000;

export function shanghaiDayWindow(date: string) {
  const start = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(start.valueOf())) throw new Error(`Invalid report date: ${date}`);
  const end = new Date(start.valueOf() + dayInMilliseconds - 1);
  return { start, end };
}

function slugify(value: string) {
  const ascii = value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return ascii || `signal-${crypto.randomUUID().slice(0, 8)}`;
}

function renderMarkdown(report: Report) {
  return `---\n${stringify(report).trimEnd()}\n---\n\n本报告由 Tech Daily & Weekly 自动生成。\n`;
}

async function retryModel<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function generateDaily(options: GenerateDailyOptions): Promise<DailyGenerationResult> {
  const window = shanghaiDayWindow(options.date);
  const now = options.now ?? new Date();
  const sourceErrors: string[] = [];
  const collected: CollectedItem[] = [];

  await Promise.all([
    mkdir(options.contentDirectory, { recursive: true }),
    mkdir(options.cacheDirectory, { recursive: true }),
    mkdir(options.dataDirectory, { recursive: true }),
  ]);
  const outputPath = join(options.contentDirectory, `${options.date}.md`);
  try {
    await access(outputPath);
    throw new Error(`Refusing to overwrite immutable daily report: ${outputPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const volumePath = join(options.dataDirectory, "source-volumes.json");
  let volumes: SourceVolumeState = {};
  try {
    volumes = JSON.parse(await readFile(volumePath, "utf8")) as SourceVolumeState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  for (const adapter of options.adapters) {
    try {
      process.stdout.write(`Collecting source ${adapter.id}...\n`);
      const items = (await adapter.collect(window)).map(normalizeCollectedItem);
      process.stdout.write(`Collected ${items.length} items from ${adapter.id}\n`);
      const previous = volumes[adapter.id]?.samples ?? [];
      const average = previous.length ? previous.reduce((total, value) => total + value, 0) / previous.length : items.length;
      const threshold = Math.max(50, average * 5);
      if (previous.length && items.length > threshold) {
        volumes[adapter.id] = { samples: previous, quarantinedAt: now.toISOString() };
        sourceErrors.push(`${adapter.id}: quarantined after unexpected volume ${items.length} > ${Math.round(threshold)}`);
        continue;
      }
      volumes[adapter.id] = { samples: [...previous, items.length].slice(-14), quarantinedAt: null };
      collected.push(...items);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`Source ${adapter.id} failed: ${message}\n`);
      sourceErrors.push(`${adapter.id}: ${message}`);
    }
  }
  process.stdout.write(`Collection finished with ${collected.length} items; starting triage/synthesis...\n`);
  await writeFile(volumePath, JSON.stringify(volumes, null, 2));
  const storiesPath = join(options.dataDirectory, "stories.json");
  let stories: StoryState = {};
  try {
    stories = JSON.parse(await readFile(storiesPath, "utf8")) as StoryState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const inWindow = collected.filter((item) => {
    const publishedAt = new Date(item.publishedAt).valueOf();
    if (publishedAt < window.start.valueOf() || publishedAt > window.end.valueOf()) return false;
    if (isHollowTrendingCandidate(item)) {
      process.stdout.write(`Skipping hollow trending candidate ${item.externalId}\n`);
      return false;
    }
    return true;
  });
  const lateItemsPath = join(options.dataDirectory, "late-items.json");
  let existingLateItems: CollectedItem[] = [];
  try {
    existingLateItems = JSON.parse(await readFile(lateItemsPath, "utf8")) as CollectedItem[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const newlyLateItems = collected.filter((item) => new Date(item.publishedAt).valueOf() < window.start.valueOf());
  const lateItems = [
    ...new Map(
      [...existingLateItems, ...newlyLateItems].map((item) => [`${item.sourceId}:${item.externalId}`, item]),
    ).values(),
  ];
  await writeFile(lateItemsPath, JSON.stringify(lateItems, null, 2));

  await writeFile(
    join(options.cacheDirectory, `${options.date}-collected.json`),
    JSON.stringify({ collectedAt: now.toISOString(), items: inWindow }, null, 2),
  );

  const candidatesPath = join(options.dataDirectory, "candidates.json");
  let existingCandidates: CollectedItem[] = [];
  try {
    existingCandidates = JSON.parse(await readFile(candidatesPath, "utf8")) as CollectedItem[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const currentClusterKeys = new Set(inWindow.map((item) => normalizeTitle(item.title)));
  const reconsideredCandidates = existingCandidates
    .filter((item) => currentClusterKeys.has(normalizeTitle(item.title)))
    .map(normalizeCollectedItem);
  const retainedCandidates = existingCandidates.filter((item) => !currentClusterKeys.has(normalizeTitle(item.title)));

  const published: ReportItem[] = [];
  const candidates: CollectedItem[] = [...retainedCandidates];
  let failedItems = 0;

  for (const { key: clusterKey, items: cluster } of clusterItems([...inWindow, ...reconsideredCandidates])) {
    const primary = cluster[0];
    if (!primary) continue;
    try {
      const triage = await retryModel(() => options.model.triage(primary));
      if (!triage.include) {
        candidates.push(...cluster);
        continue;
      }

      const independentSources = new Set(cluster.map((source) => source.sourceId)).size;
      const hasPrimarySource = cluster.some((source) => source.sourceKind === "primary");
      const lacksHighImpactVerification = triage.impact === "high" && !hasPrimarySource && independentSources < 2;
      const effectiveTriage = triage;
      const synthesis = await retryModel(() => options.model.synthesize(cluster, effectiveTriage));
      if (isHollowReportCopy(synthesis.title, synthesis.summary, synthesis.analysis)) {
        process.stdout.write(`Skipping hollow synthesis for ${primary.externalId}: ${synthesis.title}\n`);
        candidates.push(...cluster);
        continue;
      }
      const id = slugify(`${primary.externalId}-${synthesis.title}`);
      const existingStoryKey =
        primary.sourceId === "github-trending" ? `github-trending:${primary.externalId}` : clusterKey;
      const existingStory = stories[existingStoryKey];
      if (primary.sourceId === "github-trending" && existingStory) {
        // Trending repos linger for days; only keep the first appearance.
        continue;
      }
      const storyId = existingStory?.storyId ?? `story-${slugify(primary.title)}`;
      const item = reportSchema.shape.items.element.parse({
        id,
        title: synthesis.title,
        section: effectiveTriage.section,
        topics: effectiveTriage.topics,
        summary: synthesis.summary,
        analysis: synthesis.analysis,
        ...(effectiveTriage.section === "products" && primary.imageUrl
          ? { imageUrl: primary.imageUrl, imageAlt: primary.imageAlt ?? `${synthesis.title} 产品截图` }
          : {}),
        publishedAt: primary.publishedAt,
        status: lacksHighImpactVerification ? "unconfirmed" : "confirmed",
        clusterId: id,
        storyId,
        ...(existingStory ? { previousItemId: existingStory.lastItemId } : {}),
        fullTextRead: cluster.every((source) => source.fullTextRead !== false),
        sources: cluster.map((source, index) => ({
          title: source.title,
          url: source.url,
          kind: source.sourceKind,
          key: index === 0,
        })),
      });
      published.push(item);
      stories[existingStoryKey] = { storyId, lastItemId: id, lastDate: options.date };
    } catch {
      failedItems += 1;
    }
  }

  const uniqueCandidates = [...new Map(candidates.map((item) => [`${item.sourceId}:${item.externalId}`, item])).values()];
  await writeFile(candidatesPath, JSON.stringify(uniqueCandidates, null, 2));
  await writeFile(storiesPath, JSON.stringify(stories, null, 2));

  const deduplicated = mergeDuplicateReportItems(published);
  if (deduplicated.length === 0) {
    return {
      date: options.date,
      publishedItems: 0,
      candidateItems: uniqueCandidates.length,
      failedItems,
      sourceErrors,
      outputPath,
    };
  }

  const report = reportSchema.parse({
    kind: "daily",
    title: `${dailyEditionDate(window.end)} 科技日报`,
    date: options.date,
    coverageStart: window.start.toISOString(),
    coverageEnd: window.end.toISOString(),
    items: deduplicated,
  });
  await writeFile(outputPath, renderMarkdown(report), { flag: "wx" });

  return {
    date: options.date,
    publishedItems: deduplicated.length,
    candidateItems: uniqueCandidates.length,
    failedItems,
    sourceErrors,
    outputPath,
  };
}
