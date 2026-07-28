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
    imageUrl: z.url().optional(),
    imageAlt: z.string().min(1).optional(),
    publishedAt: dateTimeSchema,
    status: z.enum(["confirmed", "unconfirmed", "corrected"]).default("confirmed"),
    sources: z.array(sourceSchema).min(1),
    clusterId: z.string().optional(),
    storyId: z.string().optional(),
    previousItemId: z.string().optional(),
    correctsItemId: z.string().optional(),
    correctionReason: z.string().optional(),
    correctionDiscoveredAt: dateTimeSchema.optional(),
    fullTextRead: z.boolean().default(true),
  })
  .superRefine((item, context) => {
    if (Boolean(item.imageUrl) !== Boolean(item.imageAlt)) {
      context.addIssue({
        code: "custom",
        path: ["imageUrl"],
        message: "imageUrl and imageAlt must be provided together",
      });
    }
    if (item.imageUrl && item.section !== "products") {
      context.addIssue({
        code: "custom",
        path: ["imageUrl"],
        message: "Only product and tool items may display screenshots",
      });
    }
    if (item.section === "corrections") {
      for (const [field, value] of [
        ["correctsItemId", item.correctsItemId],
        ["correctionReason", item.correctionReason],
        ["correctionDiscoveredAt", item.correctionDiscoveredAt],
      ] as const) {
        if (!value) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `A correction requires ${field}`,
          });
        }
      }
    }
    if (["products", "research", "deep-reads", "corrections"].includes(item.section) && !item.sources.some((source) => source.key)) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: `${item.section} requires a key source`,
      });
    }
    if (item.section !== "radar" && !item.analysis.trim()) {
      context.addIssue({
        code: "custom",
        path: ["analysis"],
        message: `${item.section} requires analysis`,
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

export function dailyEditionDate(coverageEnd: string | Date) {
  const end = coverageEnd instanceof Date ? coverageEnd : new Date(coverageEnd);
  if (Number.isNaN(end.valueOf())) throw new Error(`Invalid daily coverage end: ${coverageEnd}`);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(end.valueOf() + 1));
}
