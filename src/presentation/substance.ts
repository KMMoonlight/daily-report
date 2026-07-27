/** Detect low-substance report copy that should not be published. */
export function isHollowReportCopy(title: string, summary: string, analysis: string) {
  const text = `${title}\n${summary}\n${analysis}`;
  const compact = text.replace(/\s+/g, "");
  const substancePatterns = [
    /\d+(?:\.\d+)?%/,
    /\$\d+/,
    /支持|新增|修复|兼容|集成|替代|开源许可|性能|延迟|吞吐|基准|量产|涨价|降价|免费|收费|漏洞|攻击/i,
    /API|SDK|协议|权重|评估|复现|推理|编码|补丁|版本|发布\s*v?\d/i,
    /比.+?(更快|更强|更便宜|下降|提升)/,
  ];
  const substanceHits = substancePatterns.filter((pattern) => pattern.test(text)).length;

  const fillerPatterns = [
    /提供了?新的代码参考/,
    /设计思路可能/,
    /有助于理解(?:相应的)?工程实践/,
    /通过源码体现/,
    /可供(?:开发者)?参考/,
    /值得关注/,
    /引发(?:了)?(?:社区)?讨论/,
    /展示了?.{0,12}可能性/,
  ];
  const fillerHits = fillerPatterns.filter((pattern) => pattern.test(`${summary}${analysis}`)).length;

  const repoAnnouncementOnly =
    /(?:GitHub|仓库|开源项目)/.test(`${summary}${analysis}`) &&
    /(?:公开了|发布了|开源了).{0,40}(?:仓库|项目)/.test(`${summary}${analysis}`) &&
    substanceHits === 0 &&
    fillerHits >= 1;

  if (repoAnnouncementOnly) return true;
  if (fillerHits >= 2 && substanceHits === 0) return true;
  if (compact.length < 24 && substanceHits === 0) return true;
  return false;
}

/** GitHub Trending rows with almost no project description. */
export function isHollowTrendingCandidate(input: {
  sourceId: string;
  title: string;
  excerpt: string;
}) {
  if (input.sourceId !== "github-trending") return false;
  const description = input.excerpt
    .replace(/Language:\s*[^·]+/gi, "")
    .replace(/Stars gained:\s*[\d,]+/gi, "")
    .replace(/[·•|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const titleOnly = input.title.includes(":")
    ? input.title.slice(input.title.indexOf(":") + 1).trim()
    : "";
  const substance = description || titleOnly;
  return substance.length < 18;
}
