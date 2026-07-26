import { z } from "zod";
import { sectionSchema, topicSchema } from "../domain/report";
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

const triageSchema = z.object({
  include: z.boolean(),
  section: sectionSchema.exclude(["corrections"]),
  topics: z.array(topicSchema).min(1),
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

export class HostedLanguageModel implements LanguageModel {
  constructor(
    private readonly config: HostedLanguageModelConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async triage(item: CollectedItem): Promise<TriageResult> {
    const prompt = [
      "你是面向软件开发者的科技简报编辑。",
      "判断候选是否值得进入日报。排除与科技无关的民生和纯政治内容。",
      "只返回 JSON：include(boolean), section(products|research|deep-reads|events|radar), topics(array), reason(string), impact(low|medium|high)。",
      JSON.stringify(itemContext(item)),
    ].join("\n");
    return triageSchema.parse(parseJson(await this.complete(this.config.triageModel, prompt)));
  }

  async synthesize(items: CollectedItem[], triage: TriageResult): Promise<SynthesizedItem> {
    const prompt = [
      "用简体中文为专业软件开发者编辑科技简报。",
      "严格区分可核验事实、来源观点和综合判断，不添加来源无法支持的事实。",
      "只返回 JSON：title, summary, analysis。标题简洁；摘要说明发生了什么；分析说明对开发者的意义。",
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
      });
    } else if (provider === "gemini") {
      response = await this.fetcher(
        `${baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
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
