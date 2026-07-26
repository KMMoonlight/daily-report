import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = process.cwd();
const dist = resolve(root, "dist");
const dataDir = resolve(root, ".data");
const port = Number(process.env.PORT ?? 8080);
const schedulerCli = resolve(root, "node_modules/tsx/dist/cli.mjs");
const schedulerScript = resolve(root, "src/cli/scheduler.ts");
const schedulerMinHour = Number(process.env.SCHEDULER_MIN_HOUR ?? 9);
let busy = false;
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

async function writeStatus(extra: Record<string, unknown> = {}) {
  await writeFile(
    resolve(dataDir, "scheduler-status.json"),
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        shanghaiHour: shanghaiHour(),
        schedulerMinHour,
        modelConfigured: modelIsConfigured(),
        busy,
        lastSkipReason,
        lastSchedulerAt,
        lastSchedulerResult,
        ...extra,
      },
      null,
      2,
    )}\n`,
  );
}

async function runScheduler() {
  if (busy) {
    lastSkipReason = "busy";
    await writeStatus();
    return;
  }
  if (!modelIsConfigured()) {
    lastSkipReason = "missing LLM_API_KEY / LLM_TRIAGE_MODEL / LLM_SYNTHESIS_MODEL";
    await writeStatus();
    return;
  }
  const hour = shanghaiHour();
  if (hour < schedulerMinHour) {
    lastSkipReason = `waiting until ${String(schedulerMinHour).padStart(2, "0")}:00 Asia/Shanghai (now ${String(hour).padStart(2, "0")}:xx)`;
    await writeStatus();
    return;
  }

  busy = true;
  lastSkipReason = "";
  lastSchedulerAt = new Date().toISOString();
  process.stdout.write(`Scheduler starting at ${lastSchedulerAt} (Asia/Shanghai hour ${hour})\n`);
  try {
    const { stdout, stderr } = await execute(process.execPath, [schedulerCli, schedulerScript], {
      cwd: root,
      env: { ...process.env, AUTO_PUBLISH: "false" },
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stderr.trim()) process.stderr.write(`${stderr.trim()}\n`);
    const resultLine = stdout
      .trim()
      .split("\n")
      .findLast((line) => line.startsWith("{"));
    lastSchedulerResult = resultLine ?? stdout.trim().slice(0, 500);
    if (!resultLine) {
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
    if (result.failedDailyDate || result.failedWeek) {
      process.stderr.write(`Scheduler reported failure for ${result.failedDailyDate ?? result.failedWeek}\n`);
    }
    if (result.completedDailyDates?.length || result.completedWeeks?.length) {
      await buildSite(false);
      process.stdout.write(`Rebuilt site after publishing ${resultLine}\n`);
    } else {
      process.stdout.write("Scheduler ran but nothing new was published.\n");
    }
    await writeStatus({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Scheduler failed: ${message}\n`);
    lastSchedulerResult = message;
    await writeStatus({ ok: false, error: message });
  } finally {
    busy = false;
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
  mkdir(resolve(root, "src/content/daily"), { recursive: true }),
  mkdir(resolve(root, "src/content/weekly"), { recursive: true }),
  mkdir(dataDir, { recursive: true }),
  mkdir(resolve(root, ".cache"), { recursive: true }),
]);
await buildSite(true);
await writeStatus({ phase: "boot" });

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname.replace(/\/+$/, "") || "/";
    if (pathname === "/healthz" || pathname === "/api/scheduler-status") {
      const body = await readFile(resolve(dataDir, "scheduler-status.json"), "utf8").catch(() =>
        JSON.stringify({ error: "status unavailable" }),
      );
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

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Tech Daily & Weekly is running on http://0.0.0.0:${port}\n`);
  if (!modelIsConfigured()) {
    process.stdout.write(
      "LLM variables are not configured; website is available but automatic reports are paused. Set LLM_API_KEY, LLM_TRIAGE_MODEL, LLM_SYNTHESIS_MODEL.\n",
    );
  } else {
    process.stdout.write(
      `Automatic reports enabled after ${String(schedulerMinHour).padStart(2, "0")}:00 Asia/Shanghai; checking every 15 minutes.\n`,
    );
  }
});

void runScheduler();
const timer = setInterval(() => void runScheduler(), 15 * 60 * 1000);

function shutdown() {
  clearInterval(timer);
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
