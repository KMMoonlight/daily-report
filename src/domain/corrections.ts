import type { ReportItem } from "./report";

export function validateCorrectionLinks(items: ReportItem[]) {
  const byId = new Map<string, ReportItem>();
  for (const item of items) {
    if (byId.has(item.id)) throw new Error(`Duplicate item id: ${item.id}`);
    byId.set(item.id, item);
  }

  for (const item of items) {
    if (item.correctsItemId && !byId.has(item.correctsItemId)) {
      throw new Error(`Correction ${item.id} references missing item ${item.correctsItemId}`);
    }
  }

  for (const item of items) {
    const visited = new Set<string>();
    let cursor: ReportItem | undefined = item;
    while (cursor?.correctsItemId) {
      if (visited.has(cursor.id)) throw new Error(`Correction cycle detected at ${cursor.id}`);
      visited.add(cursor.id);
      cursor = byId.get(cursor.correctsItemId);
    }
  }
}
