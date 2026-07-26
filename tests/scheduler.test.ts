import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runScheduledGeneration } from "../src/application/scheduler";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("scheduled generation", () => {
  it("backfills each missing day and retries a transient failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-scheduler-"));
    directories.push(root);
    const ledgerPath = join(root, "ledger.json");
    await writeFile(ledgerPath, JSON.stringify({ successfulDailyDates: ["2026-07-22"], successfulWeeks: [] }));
    const calls: string[] = [];
    let attemptsFor24 = 0;

    const result = await runScheduledGeneration({
      now: new Date("2026-07-26T01:00:00.000Z"),
      ledgerPath,
      logPath: join(root, "run.jsonl"),
      async generateDaily(date) {
        calls.push(date);
        if (date === "2026-07-24" && attemptsFor24++ < 1) throw new Error("temporary");
      },
      async generateWeekly() {},
    });

    expect(calls).toEqual(["2026-07-23", "2026-07-24", "2026-07-24", "2026-07-25"]);
    expect(result.completedDailyDates).toEqual(["2026-07-23", "2026-07-24", "2026-07-25"]);
    expect(JSON.parse(await readFile(ledgerPath, "utf8")).successfulDailyDates).toContain("2026-07-25");
  });

  it("stops retrying after three failed attempts without marking the day complete", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-scheduler-"));
    directories.push(root);
    let attempts = 0;

    const result = await runScheduledGeneration({
      now: new Date("2026-07-26T01:00:00.000Z"),
      startDate: "2026-07-25",
      ledgerPath: join(root, "ledger.json"),
      logPath: join(root, "run.jsonl"),
      async generateDaily() {
        attempts += 1;
        throw new Error("offline");
      },
      async generateWeekly() {},
    });

    expect(attempts).toBe(3);
    expect(result.failedDailyDate).toBe("2026-07-25");
  });
});
