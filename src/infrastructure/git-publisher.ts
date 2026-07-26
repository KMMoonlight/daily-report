import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const generatedPrefixes = ["src/content/daily/", "src/content/weekly/"];

async function git(repository: string, ...arguments_: string[]) {
  return execute("git", arguments_, { cwd: repository });
}

function changedPath(statusLine: string) {
  const path = statusLine.slice(3).trim();
  return path.includes(" -> ") ? path.split(" -> ").at(-1)! : path;
}

export async function prepareRepository(repository: string) {
  const { stdout } = await git(repository, "status", "--porcelain", "--untracked-files=all");
  if (stdout.trim()) throw new Error("Repository must be clean before scheduled generation");
  await git(repository, "pull", "--ff-only");
}

export async function publishGeneratedContent(repository: string, message: string) {
  const { stdout } = await git(repository, "status", "--porcelain", "--untracked-files=all");
  const lines = stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (!lines.length) return { pushed: false, commit: undefined };

  const unrelated = lines.map(changedPath).filter((path) => !generatedPrefixes.some((prefix) => path.startsWith(prefix)));
  if (unrelated.length) {
    throw new Error(`Refusing to publish changes outside generated content: ${unrelated.join(", ")}`);
  }

  const branch = (await git(repository, "branch", "--show-current")).stdout.trim();
  if (!branch) throw new Error("Cannot publish from a detached HEAD");
  await git(repository, "fetch", "origin", branch);
  const local = (await git(repository, "rev-parse", "HEAD")).stdout.trim();
  const remote = (await git(repository, "rev-parse", `origin/${branch}`)).stdout.trim();
  if (local !== remote) {
    throw new Error("Remote branch changed after generation; refusing a non-fast-forward publish");
  }

  await git(repository, "add", "--", "src/content");
  await git(repository, "commit", "-m", message);
  const commit = (await git(repository, "rev-parse", "HEAD")).stdout.trim();
  await git(repository, "push", "origin", branch);
  return { pushed: true, commit };
}
