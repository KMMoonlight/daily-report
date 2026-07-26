import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { topicSchema } from "./domain/report";
import type { SourceConfig } from "./infrastructure/source-adapters";

const common = {
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  language: z.enum(["zh", "en", "mixed"]).default("en"),
  enabled: z.boolean().default(true),
  topics: z.array(topicSchema).min(1),
};

const sourceConfigSchema = z.array(
  z.discriminatedUnion("type", [
    z.object({ ...common, type: z.literal("rss"), url: z.url(), sourceKind: z.enum(["primary", "media", "expert", "community"]) }),
    z.object({
      ...common,
      type: z.literal("github-trending"),
      since: z.enum(["daily", "weekly", "monthly"]).default("daily"),
      spokenLanguageCode: z.string().min(2).optional(),
    }),
    z.object({ ...common, type: z.literal("hacker-news"), minimumScore: z.number().int().nonnegative() }),
  ]),
);

export async function loadSourceConfig(path = resolve("config/sources.json")): Promise<SourceConfig[]> {
  const data = JSON.parse(await readFile(path, "utf8")) as unknown;
  return (sourceConfigSchema.parse(data) as SourceConfig[]).filter((source) => source.enabled !== false);
}

export function projectPaths(root = process.cwd()) {
  return {
    dailyContent: resolve(root, "src/content/daily"),
    weeklyContent: resolve(root, "src/content/weekly"),
    cache: resolve(root, ".cache"),
    data: resolve(root, ".data"),
  };
}
