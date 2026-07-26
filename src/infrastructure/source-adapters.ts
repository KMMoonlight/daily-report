import { XMLParser } from "fast-xml-parser";
import type { Topic } from "../domain/report";
import type { CollectedItem, CollectionWindow, SourceAdapter, SourceKind } from "./sources";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface CommonConfig {
  id: string;
  name?: string;
  language?: "zh" | "en" | "mixed";
  enabled?: boolean;
  topics: Topic[];
}

export interface RssSourceConfig extends CommonConfig {
  type: "rss";
  url: string;
  sourceKind: SourceKind;
}

export interface GitHubTrendingSourceConfig extends CommonConfig {
  type: "github-trending";
  since?: "daily" | "weekly" | "monthly";
  spokenLanguageCode?: string;
}

export interface HackerNewsSourceConfig extends CommonConfig {
  type: "hacker-news";
  minimumScore: number;
}

export type SourceConfig = RssSourceConfig | GitHubTrendingSourceConfig | HackerNewsSourceConfig;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function inWindow(isoDate: string, window: CollectionWindow) {
  const value = new Date(isoDate).valueOf();
  return value >= window.start.valueOf() && value <= window.end.valueOf();
}

function plainText(value: unknown) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function imageFromFeedEntry(entry: Record<string, any>) {
  const candidates = [
    ...asArray<Record<string, any>>(entry.thumbnail),
    ...asArray<Record<string, any>>(entry.enclosure),
    ...asArray<Record<string, any>>(entry.content),
  ];
  for (const candidate of candidates) {
    const url = candidate?.["@_url"] ?? candidate?.["@_href"];
    const type = String(candidate?.["@_type"] ?? "");
    const medium = String(candidate?.["@_medium"] ?? "");
    if (url && (medium === "image" || type.startsWith("image/") || candidate === entry.thumbnail)) {
      try {
        return new URL(String(url)).toString();
      } catch {
        // Ignore malformed feed images.
      }
    }
  }
  return undefined;
}

function responseGuard(response: Response, source: string) {
  if (!response.ok) throw new Error(`${source} returned HTTP ${response.status}`);
  return response;
}

async function fetchWithTimeout(fetcher: FetchLike, input: string, init?: RequestInit, timeoutMs = 20_000) {
  return fetcher(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export class RssAdapter implements SourceAdapter {
  readonly id: string;

  constructor(
    private readonly config: RssSourceConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.id = config.id;
  }

  async collect(window: CollectionWindow): Promise<CollectedItem[]> {
    const response = responseGuard(await fetchWithTimeout(this.fetcher, this.config.url), this.id);
    const document = xmlParser.parse(await response.text()) as Record<string, any>;
    const entries = document.rss
      ? asArray<Record<string, any>>(document.rss.channel?.item)
      : asArray<Record<string, any>>(document.feed?.entry);

    return entries
      .map((entry): CollectedItem | undefined => {
        const link =
          typeof entry.link === "string"
            ? entry.link
            : asArray<Record<string, string>>(entry.link).find((candidate) => !candidate["@_rel"] || candidate["@_rel"] === "alternate")?.[
                "@_href"
              ];
        const publishedAt = String(entry.pubDate ?? entry.published ?? entry.updated ?? "");
        if (!link || !publishedAt || !inWindow(publishedAt, window)) return undefined;
        const imageUrl = imageFromFeedEntry(entry);
        const title = plainText(entry.title?.["#text"] ?? entry.title);
        return {
          externalId: String(entry.guid?.["#text"] ?? entry.guid ?? entry.id ?? link),
          sourceId: this.id,
          title,
          url: link,
          publishedAt: new Date(publishedAt).toISOString(),
          discoveredAt: new Date().toISOString(),
          excerpt: plainText(entry.description ?? entry.summary ?? entry.content),
          sourceKind: this.config.sourceKind,
          suggestedTopics: this.config.topics,
          fullTextRead: false,
          ...(imageUrl ? { imageUrl, imageAlt: `${title} 产品截图` } : {}),
        };
      })
      .filter((item): item is CollectedItem => item !== undefined);
  }
}

export class GitHubTrendingAdapter implements SourceAdapter {
  readonly id: string;

  constructor(
    private readonly config: GitHubTrendingSourceConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.id = config.id;
  }

  async collect(window: CollectionWindow): Promise<CollectedItem[]> {
    const since = this.config.since ?? "daily";
    const params = new URLSearchParams({ since });
    if (this.config.spokenLanguageCode) params.set("spoken_language_code", this.config.spokenLanguageCode);
    const response = responseGuard(
      await fetchWithTimeout(this.fetcher, `https://github.com/trending?${params.toString()}`, {
        headers: {
          Accept: "text/html",
          "User-Agent": "TechDailyWeekly/1.0 (+https://github.com/trending)",
        },
      }, 30_000),
      this.id,
    );
    const html = await response.text();
    const rows = html.split(/<article class="Box-row"/).slice(1);
    const publishedAt = window.end.toISOString();
    const seen = new Set<string>();

    return rows
      .map((row): CollectedItem | undefined => {
        const heading = row.match(/<h2[\s\S]*?<\/h2>/)?.[0] ?? "";
        const path = heading.match(/href="(\/[^"/]+\/[^"/]+)"/)?.[1];
        if (!path) return undefined;
        const fullName = path.replace(/^\//, "");
        if (seen.has(fullName)) return undefined;
        seen.add(fullName);

        const description =
          plainText(row.match(/<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "") ||
          plainText(row.match(/<p[\s\S]*?class="[^"]*color-fg-muted[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
        const language = plainText(row.match(/itemprop="programmingLanguage">([^<]+)/)?.[1] ?? "");
        const starsToday = plainText(
          row.match(/([\d,]+)\s+stars (?:today|this week|this month)/i)?.[1] ?? "",
        ).replace(/,/g, "");
        const excerptParts = [
          description,
          language ? `Language: ${language}` : "",
          starsToday ? `Stars gained: ${starsToday}` : "",
        ].filter(Boolean);

        return {
          externalId: fullName,
          sourceId: this.id,
          title: description ? `${fullName}: ${description}` : fullName,
          url: `https://github.com/${fullName}`,
          publishedAt,
          discoveredAt: new Date().toISOString(),
          excerpt: excerptParts.join(" · "),
          sourceKind: "community",
          suggestedTopics: this.config.topics,
          fullTextRead: false,
        };
      })
      .filter((item): item is CollectedItem => item !== undefined);
  }
}

export class HackerNewsAdapter implements SourceAdapter {
  readonly id: string;

  constructor(
    private readonly config: HackerNewsSourceConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.id = config.id;
  }

  async collect(window: CollectionWindow): Promise<CollectedItem[]> {
    const idsResponse = responseGuard(
      await fetchWithTimeout(this.fetcher, "https://hacker-news.firebaseio.com/v0/topstories.json"),
      this.id,
    );
    const ids = ((await idsResponse.json()) as number[]).slice(0, 100);
    const stories = await Promise.all(
      ids.map(async (id) => {
        const response = responseGuard(
          await fetchWithTimeout(this.fetcher, `https://hacker-news.firebaseio.com/v0/item/${id}.json`),
          this.id,
        );
        return (await response.json()) as Record<string, any>;
      }),
    );
    return stories
      .filter((story) => story.score >= this.config.minimumScore)
      .map((story): CollectedItem => ({
        externalId: String(story.id),
        sourceId: this.id,
        title: plainText(story.title),
        url: String(story.url ?? `https://news.ycombinator.com/item?id=${story.id}`),
        publishedAt: new Date(Number(story.time) * 1_000).toISOString(),
        discoveredAt: new Date().toISOString(),
        excerpt: plainText(story.title),
        sourceKind: "community",
        suggestedTopics: this.config.topics,
        fullTextRead: false,
      }))
      .filter((story) => inWindow(story.publishedAt, window));
  }
}

export function createSourceAdapter(config: SourceConfig): SourceAdapter {
  switch (config.type) {
    case "rss":
      return new RssAdapter(config);
    case "github-trending":
      return new GitHubTrendingAdapter(config);
    case "hacker-news":
      return new HackerNewsAdapter(config);
  }
}
