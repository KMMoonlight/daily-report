import { describe, expect, it } from "vitest";
import { validateCorrectionLinks } from "../src/domain/corrections";
import type { ReportItem } from "../src/domain/report";

function item(id: string, correctsItemId?: string): ReportItem {
  return {
    id,
    title: id,
    section: correctsItemId ? "corrections" : "events",
    topics: ["ai"],
    summary: "summary",
    analysis: "",
    publishedAt: "2026-07-25T00:00:00.000Z",
    status: correctsItemId ? "corrected" : "confirmed",
    sources: [{ title: "source", url: "https://example.com", kind: "primary", key: true }],
    fullTextRead: true,
    ...(correctsItemId ? { correctsItemId, correctionReason: "reason" } : {}),
  };
}

describe("correction links", () => {
  it("accepts a correction that points to an existing immutable item", () => {
    expect(() => validateCorrectionLinks([item("original"), item("fix", "original")])).not.toThrow();
  });

  it("rejects missing targets and correction cycles", () => {
    expect(() => validateCorrectionLinks([item("fix", "missing")])).toThrow(/missing/);
    expect(() => validateCorrectionLinks([item("one", "two"), item("two", "one")])).toThrow(/cycle/);
  });
});
