import { describe, expect, it } from "vitest";
import { ArxivAdapter, GitHubReleasesAdapter, HackerNewsAdapter, RssAdapter } from "../src/infrastructure/source-adapters";

const window = {
  start: new Date("2026-07-24T16:00:00.000Z"),
  end: new Date("2026-07-25T15:59:59.999Z"),
};

describe("source adapters", () => {
  it("normalizes an RSS item", async () => {
    const adapter = new RssAdapter(
      {
        id: "official",
        type: "rss",
        url: "https://example.com/feed.xml",
        sourceKind: "primary",
        topics: ["ai"],
      },
      async () =>
        new Response(
          `<?xml version="1.0"?><rss><channel><item><guid>one</guid><title>Model release</title><link>https://example.com/one</link><pubDate>Sat, 25 Jul 2026 04:00:00 GMT</pubDate><description>Open weights.</description></item></channel></rss>`,
        ),
    );

    const items = await adapter.collect(window);
    expect(items[0]).toMatchObject({ externalId: "one", sourceId: "official", title: "Model release" });
  });

  it("normalizes a GitHub release", async () => {
    const adapter = new GitHubReleasesAdapter(
      { id: "repo", type: "github", repository: "owner/repo", topics: ["developer-tools"] },
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 42,
              name: "v2.0",
              html_url: "https://github.com/owner/repo/releases/tag/v2",
              published_at: "2026-07-25T04:00:00.000Z",
              body: "Faster builds",
            },
          ]),
        ),
    );

    const items = await adapter.collect(window);
    expect(items[0]).toMatchObject({ externalId: "42", sourceKind: "primary", title: "owner/repo v2.0" });
  });

  it("normalizes arXiv and Hacker News entries", async () => {
    const arxiv = new ArxivAdapter(
      { id: "arxiv-ai", type: "arxiv", category: "cs.AI", topics: ["ai"] },
      async () =>
        new Response(
          `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2607.12345</id><title>Agent Evaluation</title><updated>2026-07-25T04:00:00Z</updated><summary>A benchmark.</summary><link href="http://arxiv.org/abs/2607.12345"/></entry></feed>`,
        ),
    );
    const hackerNews = new HackerNewsAdapter(
      { id: "hn", type: "hacker-news", topics: ["tech-radar"], minimumScore: 50 },
      async (input) => {
        const url = String(input);
        if (url.endsWith("topstories.json")) return new Response("[100]");
        return new Response(
          JSON.stringify({
            id: 100,
            title: "New compiler",
            url: "https://example.com/compiler",
            time: 1784952000,
            score: 120,
          }),
        );
      },
    );

    expect((await arxiv.collect(window))[0]?.sourceKind).toBe("primary");
    expect((await hackerNews.collect(window))[0]?.sourceKind).toBe("community");
  });
});
