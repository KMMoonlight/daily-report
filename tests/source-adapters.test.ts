import { describe, expect, it } from "vitest";
import { GitHubTrendingAdapter, HackerNewsAdapter, RssAdapter } from "../src/infrastructure/source-adapters";

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
          `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><guid>one</guid><title>Model release</title><link>https://example.com/one</link><pubDate>Sat, 25 Jul 2026 04:00:00 GMT</pubDate><description>Open weights.</description><media:content url="https://example.com/model.png" medium="image"/></item></channel></rss>`,
        ),
    );

    const items = await adapter.collect(window);
    expect(items[0]).toMatchObject({
      externalId: "one",
      sourceId: "official",
      title: "Model release",
      imageUrl: "https://example.com/model.png",
      imageAlt: "Model release 产品截图",
    });
  });

  it("normalizes GitHub Trending repositories and deduplicates by repo", async () => {
    const html = `
      <article class="Box-row">
        <h2 class="h3 lh-condensed"><a href="/owner/demo">owner / demo</a></h2>
        <p class="col-9 color-fg-muted my-1 pr-4">A useful tool</p>
        <span itemprop="programmingLanguage">TypeScript</span>
        <span>120 stars today</span>
      </article>
      <article class="Box-row">
        <h2 class="h3 lh-condensed"><a href="/owner/demo">owner / demo</a></h2>
        <p class="col-9 color-fg-muted my-1 pr-4">Duplicate row</p>
      </article>
      <article class="Box-row">
        <h2 class="h3 lh-condensed"><a href="/other/app">other / app</a></h2>
        <p class="col-9 color-fg-muted my-1 pr-4">Another repo</p>
        <span>80 stars today</span>
      </article>
    `;
    const adapter = new GitHubTrendingAdapter(
      { id: "github-trending", type: "github-trending", since: "daily", topics: ["developer-tools"] },
      async () => new Response(html),
    );

    const items = await adapter.collect(window);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      externalId: "owner/demo",
      url: "https://github.com/owner/demo",
      sourceKind: "community",
      title: "owner/demo: A useful tool",
    });
    expect(items[1]?.externalId).toBe("other/app");
  });

  it("normalizes Hacker News entries", async () => {
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

    expect((await hackerNews.collect(window))[0]?.sourceKind).toBe("community");
  });
});
