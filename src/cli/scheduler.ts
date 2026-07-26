import { resolve } from "node:path";
import { generateDaily } from "../application/generate-daily";
import { generateWeekly } from "../application/generate-weekly";
import { runScheduledGeneration } from "../application/scheduler";
import { validateContentDirectory } from "../application/validate-content";
import { loadSourceConfig, projectPaths } from "../config";
import { publishGeneratedContent, prepareRepository } from "../infrastructure/git-publisher";
import { hostedLanguageModelFromEnvironment } from "../infrastructure/hosted-llm";
import { createSourceAdapter } from "../infrastructure/source-adapters";

try {
  process.loadEnvFile?.();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const root = process.cwd();
const paths = projectPaths(root);
const automaticPublish = process.env.AUTO_PUBLISH !== "false";
if (automaticPublish) await prepareRepository(root);

const sourceConfigs = await loadSourceConfig();
const adapters = sourceConfigs.map(createSourceAdapter);
const model = hostedLanguageModelFromEnvironment();
const result = await runScheduledGeneration({
  ledgerPath: resolve(paths.data, "ledger.json"),
  logPath: resolve(paths.data, "runs.jsonl"),
  async generateDaily(date) {
    await generateDaily({
      date,
      adapters,
      model,
      contentDirectory: paths.dailyContent,
      cacheDirectory: paths.cache,
      dataDirectory: paths.data,
    });
  },
  async generateWeekly(weekStart) {
    await generateWeekly({
      weekStart,
      dailyContentDirectory: paths.dailyContent,
      weeklyContentDirectory: paths.weeklyContent,
      cacheDirectory: paths.cache,
      dataDirectory: paths.data,
      model,
    });
  },
});

if (automaticPublish && (result.completedDailyDates.length || result.completedWeeks.length)) {
  await validateContentDirectory(paths.dailyContent);
  const labels = [...result.completedDailyDates, ...result.completedWeeks].join(", ");
  await publishGeneratedContent(root, `publish reports for ${labels}`);
}

process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.failedDailyDate || result.failedWeek) process.exitCode = 1;
