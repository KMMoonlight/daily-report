import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { reportSchema } from "./domain/report";

const daily = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/daily" }),
  schema: reportSchema,
});

const weekly = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/weekly" }),
  schema: reportSchema,
});

export const collections = { daily, weekly };
