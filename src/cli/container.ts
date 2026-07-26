import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = process.cwd();
const dist = resolve(root, "dist");
const dataDir = resolve(root, ".data");
const dailyDir = resolve(root, "src/content/daily");
const port = Number(process.env.PORT ?? 8080);
const schedulerCli = resolve(root, "node_modules/tsx/dist/cli.mjs");
const schedulerScript = resolve(root, "src/cli/scheduler.ts");
const schedulerMinHour = Number(process.env.SCHEDULER_MIN_HOUR ?? 9);
const schedulerTimeoutMs = Number(process.env.SCHEDULER_TIMEOUT_MS ?? 25 * 60 * 1000);
let busy = false;
let phase = "starting";
let lastSkipReason = "";
let lastSchedulerAt = "";
let lastSchedulerResult = "";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function buildSite(fullCheck = false) {
  if (fullCheck) {
    await execute("npm", ["run", "build"], {
      cwd: root,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return;
  }
  await execute("npx", ["astro", "build"], {
    cwd: root,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function shanghaiHour(now = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
}

function modelIsConfigured() {
  return Boolean(process.env.LLM_API_KEY && process.env.LLM_TRIAGE_MODEL && process.env.LLM_SYNTHESIS_MODEL);
}

async function listDailyReports() {
  try {
    return (await readdir(dailyDir)).filter((name) => name.endsWith(".md")).sort().reverse();
  } catch {
    return [];
  }
}

async function writeStatus(extra: Record<string, unknown> = {}) {
  const dailyReports = await listDailyReports();
  await writeFile(
    resolve(dataDir, "scheduler-status.json"),
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        phase,
        shanghaiHour: shanghaiHour(),
        schedulerMinHour,
        modelConfigured: modelIsConfigured(),
        busy,
        lastSkipReason,
        lastSchedulerAt,
        lastSchedulerResult,
        dailyReports,
        ...extra,
      },
      null,
      2,
    )}\n`,
  );
}

function runSchedulerProcess() {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [schedulerCli, schedulerScript], {
      cwd: root,
      env: { ...process.env, AUTO_PUBLISH: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Scheduler timed out after ${schedulerTimeoutMs}ms`));
    }, schedulerTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

async function runScheduler() {
  if (busy) {
    lastSkipReason = "busy";
    await writeStatus();
    return;
  }
  if (!modelIsConfigured()) {
    lastSkipReason = "missing LLM_API_KEY / LLM_TRIAGE_MODEL / LLM_SYNTHESIS_MODEL";
    phase = "paused";
    await writeStatus();
    return;
  }
  const hour = shanghaiHour();
  if (hour < schedulerMinHour) {
    lastSkipReason = `waiting until ${String(schedulerMinHour).padStart(2, "0")}:00 Asia/Shanghai (now ${String(hour).padStart(2, "0")}:xx)`;
    phase = "waiting-for-hour";
    await writeStatus();
    return;
  }

  busy = true;
  phase = "running";
  lastSkipReason = "";
  lastSchedulerAt = new Date().toISOString();
  await writeStatus();
  process.stdout.write(`Scheduler starting at ${lastSchedulerAt} (Asia/Shanghai hour ${hour})\n`);
  try {
    const { code, stdout, stderr } = await runSchedulerProcess();
    const resultLine = stdout
      .trim()
      .split("\n")
      .findLast((line) => line.startsWith("{") && line.includes("completedDailyDates"));
    lastSchedulerResult = resultLine ?? (stdout.trim().slice(-1000) || stderr.trim().slice(-1000));
    if (code && code !== 0 && !resultLine) {
      throw new Error(`Scheduler exited with code ${code}\n${stderr || stdout}`.trim());
    }
    if (!resultLine) {
      phase = "failed";
      process.stderr.write("Scheduler finished without a JSON result line.\n");
      await writeStatus({ ok: false });
      return;
    }
    const result = JSON.parse(resultLine) as {
      completedDailyDates?: string[];
      completedWeeks?: string[];
      failedDailyDate?: string;
      failedWeek?: string;
    };
    process.stdout.write(`Scheduler result: ${resultLine}\n`);
    if (result.failedDailyDate || result.failedWeek || (code && code !== 0)) {
      phase = "failed";
      process.stderr.write(`Scheduler reported failure for ${result.failedDailyDate ?? result.failedWeek ?? `exit ${code}`}\n`);
    } else {
      phase = "idle";
    }
    if (result.completedDailyDates?.length || result.completedWeeks?.length) {
      phase = "rebuilding";
      await writeStatus({ result });
      await buildSite(false);
      phase = "idle";
      process.stdout.write(`Rebuilt site after publishing ${resultLine}\n`);
    } else {
      process.stdout.write("Scheduler ran but nothing new was published.\n");
    }
    await writeStatus({ ok: !(result.failedDailyDate || result.failedWeek || (code && code !== 0)), result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Scheduler failed: ${message}\n`);
    lastSchedulerResult = message.slice(0, 4000);
    phase = "failed";
    await writeStatus({ ok: false, error: message.slice(0, 4000) });
  } finally {
    busy = false;
    await writeStatus();
  }
}

async function resolveStaticFile(pathname: string) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidates = [
    resolve(dist, relative),
    resolve(dist, relative, "index.html"),
    resolve(dist, `${relative}.html`),
  ];
  for (const candidate of candidates) {
    if (!candidate.startsWith(`${dist}${sep}`) && candidate !== resolve(dist, "index.html")) continue;
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next static path form.
    }
  }
  return undefined;
}

await Promise.all([
  mkdir(dailyDir, { recursive: true }),
  mkdir(resolve(root, "src/content/weekly"), { recursive: true }),
  mkdir(dataDir, { recursive: true }),
  mkdir(resolve(root, ".cache"), { recursive: true }),
]);

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname.replace(/\/+$/, "") || "/";
    if (pathname === "/healthz" || pathname === "/api/scheduler-status") {
      await writeStatus();
      const body = await readFile(resolve(dataDir, "scheduler-status.json"), "utf8");
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
      response.end(body);
      return;
    }
    const file = await resolveStaticFile(pathname);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const extension = extname(file);
    response.writeHead(200, {
      "content-type": contentTypes[extension] ?? "application/octet-stream",
      "cache-control": extension === ".html" ? "no-cache" : "public, max-age=604800, immutable",
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
  }
});

await new Promise<void>((resolveListen) => {
  server.listen(port, "0.0.0.0", () => resolveListen());
});
process.stdout.write(`Tech Daily & Weekly is running on http://0.0.0.0:${port}\n`);
phase = "booting-site";
await writeStatus();

try {
  await buildSite(true);
  phase = modelIsConfigured() ? "ready" : "paused";
  await writeStatus();
} catch (error) {
  phase = "boot-failed";
  lastSchedulerResult = error instanceof Error ? error.message : String(error);
  await writeStatus({ ok: false });
  throw error;
}

if (!modelIsConfigured()) {
  process.stdout.write(
    "LLM variables are not configured; website is available but automatic reports are paused. Set LLM_API_KEY, LLM_TRIAGE_MODEL, LLM_SYNTHESIS_MODEL.\n",
  );
} else {
  process.stdout.write(
    `Automatic reports enabled after ${String(schedulerMinHour).padStart(2, "0")}:00 Asia/Shanghai; checking every 15 minutes.\n`,
  );
}

void runScheduler();
const timer = setInterval(() => void runScheduler(), 15 * 60 * 1000);

function shutdown() {
  clearInterval(timer);
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
