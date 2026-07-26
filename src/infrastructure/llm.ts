import type { ReportSection, Topic } from "../domain/report";
import type { CollectedItem } from "./sources";

export interface TriageResult {
  include: boolean;
  section: Exclude<ReportSection, "corrections">;
  topics: Topic[];
  reason: string;
  impact?: "low" | "medium" | "high";
}

export interface SynthesizedItem {
  title: string;
  summary: string;
  analysis: string;
}

export interface LanguageModel {
  triage(item: CollectedItem): Promise<TriageResult>;
  synthesize(items: CollectedItem[], triage: TriageResult): Promise<SynthesizedItem>;
  weeklySynthesis(items: Array<{ title: string; summary: string; analysis: string }>): Promise<string>;
}
