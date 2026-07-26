import { generateWeekly } from "../application/generate-weekly";
import { projectPaths } from "../config";
import { hostedLanguageModelFromEnvironment } from "../infrastructure/hosted-llm";

function previousWeekStart(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const date = new Date(`${today}T12:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday - 7);
  return date.toISOString().slice(0, 10);
}

const weekArgument = process.argv.find((argument) => argument.startsWith("--week-start="))?.split("=")[1];
const weekStart = weekArgument ?? previousWeekStart();
const paths = projectPaths();
const result = await generateWeekly({
  weekStart,
  dailyContentDirectory: paths.dailyContent,
  weeklyContentDirectory: paths.weeklyContent,
  cacheDirectory: paths.cache,
  dataDirectory: paths.data,
  model: hostedLanguageModelFromEnvironment(),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
