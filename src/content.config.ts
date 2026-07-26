import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { reportSchema } from "./domain/report";

const contentRoot = process.env.CONTENT_ROOT ?? "./src/content";

const daily = defineCollection({
  loader: glob({ pattern: "**/*.md", base: `${contentRoot}/daily` }),
  schema: reportSchema,
});

const weekly = defineCollection({
  loader: glob({ pattern: "**/*.md", base: `${contentRoot}/weekly` }),
  schema: reportSchema,
});

export const collections = { daily, weekly };
