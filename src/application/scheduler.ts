import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface Ledger {
  successfulDailyDates: string[];
  successfulWeeks: string[];
}

interface SchedulerOptions {
  now?: Date;
  startDate?: string;
  ledgerPath: string;
  logPath: string;
  generateDaily(date: string): Promise<void>;
  generateWeekly(weekStart: string): Promise<void>;
}

export interface SchedulerResult {
  completedDailyDates: string[];
  completedWeeks: string[];
  failedDailyDate?: string;
  failedWeek?: string;
}

function shanghaiDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

function previousMonday(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - daysSinceMonday - 7);
  return value.toISOString().slice(0, 10);
}

async function readLedger(path: string): Promise<Ledger | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Ledger;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function retry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function runScheduledGeneration(options: SchedulerOptions): Promise<SchedulerResult> {
  const now = options.now ?? new Date();
  const today = shanghaiDate(now);
  const targetDailyDate = addDays(today, -1);
  const existingLedger = await readLedger(options.ledgerPath);
  const ledger: Ledger = existingLedger ?? { successfulDailyDates: [], successfulWeeks: [] };
  const firstDate =
    options.startDate ??
    (ledger.successfulDailyDates.length
      ? addDays([...ledger.successfulDailyDates].sort().at(-1)!, 1)
      : targetDailyDate);
  const result: SchedulerResult = { completedDailyDates: [], completedWeeks: [] };

  await Promise.all([mkdir(dirname(options.ledgerPath), { recursive: true }), mkdir(dirname(options.logPath), { recursive: true })]);
  const log = async (event: Record<string, unknown>) => {
    await appendFile(options.logPath, `${JSON.stringify({ at: now.toISOString(), ...event })}\n`);
  };
  const persist = async () => {
    await writeFile(options.ledgerPath, JSON.stringify(ledger, null, 2));
  };

  if (firstDate <= targetDailyDate) {
    for (const date of datesBetween(firstDate, targetDailyDate)) {
      if (ledger.successfulDailyDates.includes(date)) continue;
      try {
        await retry(() => options.generateDaily(date));
        ledger.successfulDailyDates.push(date);
        ledger.successfulDailyDates.sort();
        result.completedDailyDates.push(date);
        await persist();
        await log({ event: "daily-succeeded", date });
      } catch (error) {
        result.failedDailyDate = date;
        await log({ event: "daily-failed", date, error: error instanceof Error ? error.message : String(error) });
        return result;
      }
    }
  }

  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = localParts.find((part) => part.type === "weekday")?.value;
  const hour = Number(localParts.find((part) => part.type === "hour")?.value ?? 0);
  if (weekday === "Mon" && hour >= 10) {
    const weekStart = previousMonday(today);
    if (!ledger.successfulWeeks.includes(weekStart)) {
      try {
        await retry(() => options.generateWeekly(weekStart));
        ledger.successfulWeeks.push(weekStart);
        ledger.successfulWeeks.sort();
        result.completedWeeks.push(weekStart);
        await persist();
        await log({ event: "weekly-succeeded", weekStart });
      } catch (error) {
        result.failedWeek = weekStart;
        await log({ event: "weekly-failed", weekStart, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return result;
}
