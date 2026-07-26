import { z } from "zod";

const dateSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value),
  z.iso.date(),
);

const dateTimeSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.iso.datetime(),
);

export const sectionSchema = z.enum([
  "products",
  "research",
  "deep-reads",
  "events",
  "radar",
  "corrections",
]);

export const topicSchema = z.enum([
  "ai",
  "developer-tools",
  "chips",
  "robotics",
  "consumer-tech",
  "tech-radar",
]);

export const sourceSchema = z.object({
  title: z.string().min(1),
  url: z.url(),
  kind: z.enum(["primary", "media", "expert", "community"]),
  key: z.boolean().default(false),
});

export const reportItemSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().min(1),
    section: sectionSchema,
    topics: z.array(topicSchema).min(1),
    summary: z.string().min(1),
    analysis: z.string().default(""),
    publishedAt: dateTimeSchema,
    status: z.enum(["confirmed", "unconfirmed", "corrected"]).default("confirmed"),
    sources: z.array(sourceSchema).min(1),
    clusterId: z.string().optional(),
    storyId: z.string().optional(),
    previousItemId: z.string().optional(),
    correctsItemId: z.string().optional(),
    correctionReason: z.string().optional(),
    fullTextRead: z.boolean().default(true),
  })
  .superRefine((item, context) => {
    if (item.section === "corrections" && !item.correctsItemId) {
      context.addIssue({
        code: "custom",
        path: ["correctsItemId"],
        message: "A correction must reference the original item",
      });
    }
  });

export const reportSchema = z.object({
  kind: z.enum(["daily", "weekly"]),
  title: z.string().min(1),
  date: dateSchema,
  coverageStart: dateTimeSchema,
  coverageEnd: dateTimeSchema,
  trendSummary: z.string().optional(),
  items: z.array(reportItemSchema),
});

export type Report = z.infer<typeof reportSchema>;
export type ReportItem = z.infer<typeof reportItemSchema>;
export type ReportSection = z.infer<typeof sectionSchema>;
export type Topic = z.infer<typeof topicSchema>;
