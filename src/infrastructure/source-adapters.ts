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

export interface GitHubSourceConfig extends CommonConfig {
  type: "github";
  repository: string;
}

export interface ArxivSourceConfig extends CommonConfig {
  type: "arxiv";
  category: string;
}

export interface HackerNewsSourceConfig extends CommonConfig {
  type: "hacker-news";
  minimumScore: number;
}

export type SourceConfig = RssSourceConfig | GitHubSourceConfig | ArxivSourceConfig | HackerNewsSourceConfig;

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

export class RssAdapter implements SourceAdapter {
  readonly id: string;

  constructor(
    private readonly config: RssSourceConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.id = config.id;
  }

  async collect(window: CollectionWindow): Promise<CollectedItem[]> {
    const response = responseGuard(await this.fetcher(this.config.url), this.id);
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

export class GitHubReleasesAdapter implements SourceAdapter {
  readonly id: string;

  constructor(
    private readonly config: GitHubSourceConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.id = config.id;
  }

  async collect(window: CollectionWindow): Promise<CollectedItem[]> {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = responseGuard(
      await this.fetcher(`https://api.github.com/repos/${this.config.repository}/releases?per_page=20`, { headers }),
      this.id,
    );
    const releases = (await response.json()) as Array<Record<string, any>>;
    return releases
      .filter((release) => release.published_at && inWindow(release.published_at, window))
      .map((release) => ({
        externalId: String(release.id),
        sourceId: this.id,
        title: `${this.config.repository} ${release.name || release.tag_name}`,
        url: String(release.html_url),
        publishedAt: new Date(release.published_at).toISOString(),
        discoveredAt: new Date().toISOString(),
        excerpt: plainText(release.body),
        sourceKind: "primary",
        suggestedTopics: this.config.topics,
        fullTextRead: true,
      }));
  }
}

export class ArxivAdapter implements SourceAdapter {
  readonly id: string;

  constructor(
    private readonly config: ArxivSourceConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.id = config.id;
  }

  async collect(window: CollectionWindow): Promise<CollectedItem[]> {
    const url = `https://export.arxiv.org/api/query?search_query=cat:${encodeURIComponent(this.config.category)}&sortBy=submittedDate&sortOrder=descending&max_results=100`;
    const response = responseGuard(await this.fetcher(url), this.id);
    const document = xmlParser.parse(await response.text()) as Record<string, any>;
    return asArray<Record<string, any>>(document.feed?.entry)
      .map((entry): CollectedItem | undefined => {
        const publishedAt = String(entry.published ?? entry.updated ?? "");
        const links = asArray<Record<string, string>>(entry.link);
        const link = links.find((candidate) => candidate["@_rel"] === "alternate")?.["@_href"] ?? String(entry.id ?? "");
        if (!publishedAt || !link || !inWindow(publishedAt, window)) return undefined;
        return {
          externalId: String(entry.id ?? link).split("/").pop() ?? link,
          sourceId: this.id,
          title: plainText(entry.title),
          url: link,
          publishedAt: new Date(publishedAt).toISOString(),
          discoveredAt: new Date().toISOString(),
          excerpt: plainText(entry.summary),
          sourceKind: "primary",
          suggestedTopics: this.config.topics,
          fullTextRead: true,
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
      await this.fetcher("https://hacker-news.firebaseio.com/v0/topstories.json"),
      this.id,
    );
    const ids = ((await idsResponse.json()) as number[]).slice(0, 100);
    const stories = await Promise.all(
      ids.map(async (id) => {
        const response = responseGuard(
          await this.fetcher(`https://hacker-news.firebaseio.com/v0/item/${id}.json`),
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
    case "github":
      return new GitHubReleasesAdapter(config);
    case "arxiv":
      return new ArxivAdapter(config);
    case "hacker-news":
      return new HackerNewsAdapter(config);
  }
}
