import { createHash } from "node:crypto";
import type { ReportItem } from "../domain/report";
import type { CollectedItem } from "../infrastructure/sources";

export function normalizeTitle(title: string) {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

export function canonicalUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || key === "ref" || key === "source") url.searchParams.delete(key);
  }
  url.hash = "";
  return url.toString();
}

export function titleTokens(title: string) {
  const normalized = normalizeTitle(title);
  const tokens = new Set<string>();

  for (const latin of normalized.match(/[a-z0-9]+(?:\.[a-z0-9]+)*/g) ?? []) {
    if (latin.length > 1) tokens.add(latin);
  }

  for (const run of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (run.length <= 2) {
      tokens.add(run);
      continue;
    }
    for (let index = 0; index < run.length - 1; index += 1) tokens.add(run.slice(index, index + 2));
    if (run.length >= 3) {
      for (let index = 0; index < run.length - 2; index += 1) tokens.add(run.slice(index, index + 3));
    }
  }

  return tokens;
}

export function titleSimilarity(left: string, right: string) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

/** Compact product/event signatures so "Claude Opus 5 正式发布" matches "Anthropic发布Claude Opus 5". */
export function eventSignatures(...parts: string[]) {
  const text = parts
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase();
  const compact = text.replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "");
  const signatures = new Set<string>();

  for (const match of compact.matchAll(
    /(?:claude(?:opus)?|gpt|gemini(?:pro|flash)?|llama|qwen|deepseek|kimi|ollama|openai|anthropic|nvidia|apple)[a-z0-9]{0,24}\d+(?:\.\d+)?[a-z]?/g,
  )) {
    signatures.add(match[0]);
  }

  for (const match of text.matchAll(
    /\b(?:claude(?:\s+opus)?|gpt|gemini|llama|qwen|deepseek|kimi)\s*[-\s]?\d+(?:\.\d+)?[a-z]?\b/g,
  )) {
    signatures.add(match[0].replace(/[\s-]+/g, ""));
  }

  // Generic Latin product + version, e.g. "next.js 16", "fedora 45"
  for (const match of text.matchAll(/\b[a-z][a-z0-9.+]{1,}(?:\s+[a-z0-9.+]+){0,2}\s+\d+(?:\.\d+)?\b/g)) {
    const key = match[0].replace(/[\s.]+/g, "");
    if (key.length >= 6) signatures.add(key);
  }

  return signatures;
}

export function shareEventSignature(left: string, right: string) {
  const leftSignatures = eventSignatures(left);
  const rightSignatures = eventSignatures(right);
  for (const signature of leftSignatures) {
    if (signature.length >= 6 && rightSignatures.has(signature)) return true;
  }
  return false;
}

export function normalizeCollectedItem(item: CollectedItem): CollectedItem {
  const normalizedUrl = canonicalUrl(item.url);
  const contentFingerprint = createHash("sha256")
    .update(`${normalizeTitle(item.title)}\n${item.excerpt.trim().toLocaleLowerCase()}`)
    .digest("hex");
  return { ...item, normalizedUrl, contentFingerprint };
}

export function sameCollectedEvent(left: CollectedItem, right: CollectedItem) {
  if (left.normalizedUrl && right.normalizedUrl && left.normalizedUrl === right.normalizedUrl) return true;
  if (left.contentFingerprint && right.contentFingerprint && left.contentFingerprint === right.contentFingerprint) {
    return true;
  }
  if (shareEventSignature(`${left.title} ${left.excerpt}`, `${right.title} ${right.excerpt}`)) return true;
  if (titleSimilarity(left.title, right.title) >= 0.45) return true;
  if (
    titleSimilarity(left.title, right.title) >= 0.28 &&
    titleSimilarity(`${left.title} ${left.excerpt}`, `${right.title} ${right.excerpt}`) >= 0.35
  ) {
    return true;
  }
  return false;
}

export function clusterItems(items: CollectedItem[]) {
  const clusters: CollectedItem[][] = [];
  for (const item of items) {
    const existing = clusters.find((cluster) => cluster.some((candidate) => sameCollectedEvent(candidate, item)));
    if (existing) existing.push(item);
    else clusters.push([item]);
  }
  return clusters.map((cluster) => ({
    key: [...eventSignatures(cluster[0]?.title ?? "")][0] || normalizeTitle(cluster[0]?.title ?? "") || cluster[0]?.contentFingerprint || "",
    items: cluster,
  }));
}

function publishedScore(item: ReportItem) {
  const keySources = item.sources.filter((source) => source.key || source.kind === "primary").length;
  return keySources * 1000 + item.summary.length + item.analysis.length + item.sources.length * 20;
}

export function mergeDuplicateReportItems(items: ReportItem[]) {
  const groups: ReportItem[][] = [];
  for (const item of items) {
    const existing = groups.find((group) =>
      group.some(
        (candidate) =>
          shareEventSignature(candidate.title, item.title) ||
          titleSimilarity(candidate.title, item.title) >= 0.5 ||
          (titleSimilarity(candidate.title, item.title) >= 0.32 &&
            titleSimilarity(`${candidate.title} ${candidate.summary}`, `${item.title} ${item.summary}`) >= 0.4),
      ),
    );
    if (existing) existing.push(item);
    else groups.push([item]);
  }

  return groups.map((group) => {
    const ranked = [...group].sort((left, right) => publishedScore(right) - publishedScore(left));
    const primary = ranked[0]!;
    if (ranked.length === 1) return primary;
    const sourceMap = new Map<string, (typeof primary.sources)[number]>();
    for (const item of ranked) {
      for (const source of item.sources) {
        if (!sourceMap.has(source.url)) sourceMap.set(source.url, { ...source, key: false });
      }
    }
    const sources = [...sourceMap.values()];
    if (sources[0]) sources[0] = { ...sources[0], key: true };
    return {
      ...primary,
      sources,
    };
  });
}
