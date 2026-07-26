import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { reportSchema, type Report, type ReportItem } from "../domain/report";
import type { LanguageModel } from "../infrastructure/llm";
import type { CollectedItem, SourceAdapter } from "../infrastructure/sources";

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

function normalizeTitle(title: string) {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function canonicalUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || key === "ref" || key === "source") url.searchParams.delete(key);
  }
  url.hash = "";
  return url.toString();
}

function titleTokens(title: string) {
  return new Set(normalizeTitle(title).split(" ").filter(Boolean));
}

function titleSimilarity(left: string, right: string) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function normalizeCollectedItem(item: CollectedItem): CollectedItem {
  const normalizedUrl = canonicalUrl(item.url);
  const contentFingerprint = createHash("sha256")
    .update(`${normalizeTitle(item.title)}\n${item.excerpt.trim().toLocaleLowerCase()}`)
    .digest("hex");
  return { ...item, normalizedUrl, contentFingerprint };
}

function clusterItems(items: CollectedItem[]) {
  const clusters: CollectedItem[][] = [];
  for (const item of items) {
    const existing = clusters.find((cluster) =>
      cluster.some(
        (candidate) =>
          candidate.normalizedUrl === item.normalizedUrl ||
          candidate.contentFingerprint === item.contentFingerprint ||
          titleSimilarity(candidate.title, item.title) >= 0.7,
      ),
    );
    if (existing) existing.push(item);
    else clusters.push([item]);
  }
  return clusters.map((cluster) => ({
    key: normalizeTitle(cluster[0]?.title ?? "") || cluster[0]?.contentFingerprint || "",
    items: cluster,
  }));
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
      const items = (await adapter.collect(window)).map(normalizeCollectedItem);
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
      sourceErrors.push(`${adapter.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
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
    return publishedAt >= window.start.valueOf() && publishedAt <= window.end.valueOf();
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
      const triage = await options.model.triage(primary);
      if (!triage.include) {
        candidates.push(...cluster);
        continue;
      }

      const independentSources = new Set(cluster.map((source) => source.sourceId)).size;
      const hasPrimarySource = cluster.some((source) => source.sourceKind === "primary");
      const lacksHighImpactVerification = triage.impact === "high" && !hasPrimarySource && independentSources < 2;
      if (
        lacksHighImpactVerification &&
        cluster.every((source) => source.sourceKind === "community")
      ) {
        candidates.push(...cluster);
        continue;
      }
      const effectiveTriage = lacksHighImpactVerification ? { ...triage, section: "radar" as const } : triage;
      const synthesis = await options.model.synthesize(cluster, effectiveTriage);
      const id = slugify(`${primary.externalId}-${synthesis.title}`);
      const existingStory = stories[clusterKey];
      const storyId = existingStory?.storyId ?? `story-${slugify(primary.title)}`;
      const item = reportSchema.shape.items.element.parse({
        id,
        title: synthesis.title,
        section: effectiveTriage.section,
        topics: effectiveTriage.topics,
        summary: synthesis.summary,
        analysis: synthesis.analysis,
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
      stories[clusterKey] = { storyId, lastItemId: id, lastDate: options.date };
    } catch {
      failedItems += 1;
    }
  }

  const uniqueCandidates = [...new Map(candidates.map((item) => [`${item.sourceId}:${item.externalId}`, item])).values()];
  await writeFile(candidatesPath, JSON.stringify(uniqueCandidates, null, 2));
  await writeFile(storiesPath, JSON.stringify(stories, null, 2));

  const report = reportSchema.parse({
    kind: "daily",
    title: `${options.date} 科技日报`,
    date: options.date,
    coverageStart: window.start.toISOString(),
    coverageEnd: window.end.toISOString(),
    items: published,
  });
  await writeFile(outputPath, renderMarkdown(report), { flag: "wx" });

  return {
    date: options.date,
    publishedItems: published.length,
    candidateItems: uniqueCandidates.length,
    failedItems,
    sourceErrors,
    outputPath,
  };
}
