import { generateDaily } from "../application/generate-daily";
import { loadSourceConfig, projectPaths } from "../config";
import { hostedLanguageModelFromEnvironment } from "../infrastructure/hosted-llm";
import { createSourceAdapter } from "../infrastructure/source-adapters";

function previousShanghaiDate(now = new Date()) {
  const yesterday = new Date(now.valueOf() - 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(yesterday);
}

const dateArgument = process.argv.find((argument) => argument.startsWith("--date="))?.split("=")[1];
const date = dateArgument ?? previousShanghaiDate();
const paths = projectPaths();
const sourceConfigs = await loadSourceConfig();
const result = await generateDaily({
  date,
  adapters: sourceConfigs.map(createSourceAdapter),
  model: hostedLanguageModelFromEnvironment(),
  contentDirectory: paths.dailyContent,
  cacheDirectory: paths.cache,
  dataDirectory: paths.data,
});

process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.publishedItems === 0 && result.failedItems > 0) process.exitCode = 1;
