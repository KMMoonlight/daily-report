import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = process.cwd();
const dist = resolve(root, "dist");
const port = Number(process.env.PORT ?? 8080);
const schedulerCli = resolve(root, "node_modules/tsx/dist/cli.mjs");
const schedulerScript = resolve(root, "src/cli/scheduler.ts");
let busy = false;

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function buildSite() {
  await execute("npm", ["run", "build"], {
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

async function runScheduler() {
  if (busy || !modelIsConfigured() || shanghaiHour() < 9) return;
  busy = true;
  try {
    const { stdout } = await execute(process.execPath, [schedulerCli, schedulerScript], {
      cwd: root,
      env: { ...process.env, AUTO_PUBLISH: "false" },
      maxBuffer: 10 * 1024 * 1024,
    });
    const resultLine = stdout
      .trim()
      .split("\n")
      .findLast((line) => line.startsWith("{"));
    if (!resultLine) return;
    const result = JSON.parse(resultLine) as {
      completedDailyDates?: string[];
      completedWeeks?: string[];
    };
    if (result.completedDailyDates?.length || result.completedWeeks?.length) {
      await buildSite();
      process.stdout.write(`Rebuilt site after publishing ${resultLine}\n`);
    }
  } catch (error) {
    process.stderr.write(`Scheduler failed: ${error instanceof Error ? error.message : String(error)}\n`);
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
  mkdir(resolve(root, ".data"), { recursive: true }),
  mkdir(resolve(root, ".cache"), { recursive: true }),
]);
await buildSite();

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
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
    process.stdout.write("LLM variables are not configured; website is available but automatic reports are paused.\n");
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
