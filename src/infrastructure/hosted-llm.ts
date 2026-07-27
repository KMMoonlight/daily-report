import { z } from "zod";
import { sectionSchema, topicSchema, type Topic } from "../domain/report";
import type { LanguageModel, SynthesizedItem, TriageResult } from "./llm";
import type { CollectedItem } from "./sources";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Provider = "openai-compatible" | "anthropic" | "gemini";

interface HostedLanguageModelConfig {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  triageModel: string;
  synthesisModel: string;
}

const rawTriageSchema = z.object({
  include: z.boolean(),
  section: sectionSchema.exclude(["corrections"]),
  topics: z.array(z.string()).default([]),
  reason: z.string(),
  impact: z.enum(["low", "medium", "high"]).default("medium"),
});

const synthesisSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  analysis: z.string(),
});

function parseJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Model response did not contain a JSON object");
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

function itemContext(item: CollectedItem) {
  return {
    title: item.title,
    url: item.url,
    excerpt: item.excerpt,
    sourceKind: item.sourceKind,
    suggestedTopics: item.suggestedTopics,
    publishedAt: item.publishedAt,
  };
}

const topicAliases: Record<string, Topic> = {
  "artificial-intelligence": "ai",
  "machine-learning": "ai",
  llm: "ai",
  agents: "ai",
  programming: "developer-tools",
  software: "developer-tools",
  "software-engineering": "developer-tools",
  "open-source": "developer-tools",
  cloud: "developer-tools",
  networking: "developer-tools",
  internet: "developer-tools",
  security: "developer-tools",
  databases: "developer-tools",
  "web-development": "developer-tools",
  semiconductors: "chips",
  hardware: "chips",
  compute: "chips",
  infrastructure: "chips",
  automotive: "robotics",
  "autonomous-driving": "robotics",
  "consumer-electronics": "consumer-tech",
  mobile: "consumer-tech",
  "internet-products": "consumer-tech",
  biotech: "tech-radar",
  energy: "tech-radar",
  science: "tech-radar",
};

function normalizeTopics(values: string[], fallback: Topic[]): Topic[] {
  const normalized = values.flatMap((value): Topic[] => {
    const key = value.trim().toLocaleLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
    const knownTopic = topicSchema.safeParse(key);
    if (knownTopic.success) return [knownTopic.data];
    const alias = topicAliases[key];
    return alias ? [alias] : [];
  });
  const selected: Topic[] = normalized.length ? normalized : fallback.length ? fallback : ["tech-radar"];
  return [...new Set<Topic>(selected)];
}

export class HostedLanguageModel implements LanguageModel {
  constructor(
    private readonly config: HostedLanguageModelConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async triage(item: CollectedItem): Promise<TriageResult> {
    const prompt = [
      "你是面向软件开发者的科技简报编辑。",
      "判断候选是否值得进入日报。排除与科技无关的民生和纯政治内容。",
      "社区平台只用于发现线索；如果材料只有帖子热度、点赞或评论数，没有可核验的产品、技术或行业事实，include 必须为 false。",
      "如果材料只说明某仓库/项目出现在榜单或被公开，却没有具体用途、能力、变更或技术细节，include 必须为 false。",
      "单一来源、证据有限或尚未得到独立验证，不是排除理由；只要事件本身具体且与科技相关即可 include。",
      "只返回 JSON：include(boolean), section(products|research|deep-reads|events|radar), topics(array), reason(string), impact(low|medium|high)。",
      "topics 只能使用：ai、developer-tools、chips、robotics、consumer-tech、tech-radar；不得创造其他标签。",
      JSON.stringify(itemContext(item)),
    ].join("\n");
    const triage = rawTriageSchema.parse(parseJson(await this.complete(this.config.triageModel, prompt)));
    return { ...triage, topics: normalizeTopics(triage.topics, item.suggestedTopics) };
  }

  async synthesize(items: CollectedItem[], triage: TriageResult): Promise<SynthesizedItem> {
    const prompt = [
      "用简体中文为专业软件开发者编辑科技简报。",
      "严格区分可核验事实、来源观点和综合判断，不添加来源无法支持的事实。",
      "只返回 JSON：title, summary, analysis。标题简洁。",
      "summary 与 analysis 会合并成一段正文展示，因此两者必须能直接首尾相接、读起来像同一篇连贯短评，不要写成互相独立的两段开场白。",
      "summary：2 至 4 句，交代发生了什么、具体变化或能力、关键细节；直接陈述事实，不要用“一篇题为…的文章”“一款名为…的产品”这类空壳起笔。",
      "analysis：1 至 3 句，紧接 summary 说明对开发者、技术选型或行业判断的意义；不要重复 summary，也不要以“高关注度反映出”开场。",
      "每句话都必须提供新增信息，不要同义反复或使用空泛背景凑字数。",
      "不要添加免责声明、“待验证”“尚待确认”等声明；只陈述来源实际提供的具体信息。",
      "来源细节有限时可以短于建议字数，但不得杜撰，也不得用免责声明或社区热度凑内容。",
      "如果来源不足以写出具体用途、能力或变化，不要用“提供代码参考”“有助于理解工程实践”等空话填满；这种情况本应在初筛排除。",
      "不能写点赞数、评论数、Hacker News/Reddit 分数，或其他社区热度数值；也不要写“引发关注”“受到热议”“根据社区热门帖子”等空泛或抓取感表述。",
      "不要用社区平台热度或帖子来源来证明选题价值；直接写清事实与判断。",
      "读者应感觉这是编辑挑选后的分析，而不是按热度抓取的排行榜。",
      `栏目：${triage.section}；主题：${triage.topics.join(",")}`,
      JSON.stringify(items.map(itemContext)),
    ].join("\n");
    return synthesisSchema.parse(parseJson(await this.complete(this.config.synthesisModel, prompt)));
  }

  async weeklySynthesis(items: Array<{ title: string; summary: string; analysis: string }>): Promise<string> {
    const prompt = [
      "综合以下一周科技条目，为专业软件开发者写一段简体中文全局趋势分析。",
      "不要逐条复述；合并重复事实，指出跨条目的变化，并明确避免无证据预测。",
      "直接返回正文，不要 Markdown 标题。",
      JSON.stringify(items),
    ].join("\n");
    return (await this.complete(this.config.synthesisModel, prompt)).trim();
  }

  private async complete(model: string, prompt: string) {
    const { provider, apiKey, baseUrl } = this.config;
    const signal = AbortSignal.timeout(120_000);
    let response: Response;

    if (provider === "anthropic") {
      response = await this.fetcher(`${baseUrl.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model, max_tokens: 2_000, messages: [{ role: "user", content: prompt }] }),
        signal,
      });
    } else if (provider === "gemini") {
      response = await this.fetcher(
        `${baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal,
        },
      );
    } else {
      response = await this.fetcher(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
        signal,
      });
    }

    if (!response.ok) throw new Error(`LLM request failed with HTTP ${response.status}`);
    const body = (await response.json()) as Record<string, any>;
    if (provider === "anthropic") return String(body.content?.[0]?.text ?? "");
    if (provider === "gemini") return String(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    return String(body.choices?.[0]?.message?.content ?? "");
  }
}

export function hostedLanguageModelFromEnvironment() {
  const provider = (process.env.LLM_PROVIDER ?? "openai-compatible") as Provider;
  const apiKey = process.env.LLM_API_KEY;
  const triageModel = process.env.LLM_TRIAGE_MODEL;
  const synthesisModel = process.env.LLM_SYNTHESIS_MODEL;
  if (!apiKey || !triageModel || !synthesisModel) {
    throw new Error("LLM_API_KEY, LLM_TRIAGE_MODEL and LLM_SYNTHESIS_MODEL are required");
  }
  const defaults: Record<Provider, string> = {
    "openai-compatible": "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
  };
  return new HostedLanguageModel({
    provider,
    apiKey,
    baseUrl: process.env.LLM_BASE_URL ?? defaults[provider],
    triageModel,
    synthesisModel,
  });
}
