import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { validateCorrectionLinks } from "../domain/corrections";
import { reportSchema, type Report } from "../domain/report";

export async function validateContentDirectory(directory: string) {
  const reports: Report[] = [];
  const files = (await readdir(directory).catch(() => []))
    .filter((file) => file.endsWith(".md"))
    .sort();
  for (const file of files) {
    const { data } = matter(await readFile(join(directory, file), "utf8"));
    reports.push(reportSchema.parse(data));
  }
  validateCorrectionLinks(reports.flatMap((report) => report.items));
  return reports;
}
