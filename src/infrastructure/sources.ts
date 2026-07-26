import type { Topic } from "../domain/report";

export type SourceKind = "primary" | "media" | "expert" | "community";

export interface CollectedItem {
  externalId: string;
  sourceId: string;
  title: string;
  url: string;
  publishedAt: string;
  discoveredAt: string;
  excerpt: string;
  sourceKind: SourceKind;
  suggestedTopics: Topic[];
  fullTextRead?: boolean;
  normalizedUrl?: string;
  contentFingerprint?: string;
}

export interface CollectionWindow {
  start: Date;
  end: Date;
}

export interface SourceAdapter {
  id: string;
  collect(window: CollectionWindow): Promise<CollectedItem[]>;
}
