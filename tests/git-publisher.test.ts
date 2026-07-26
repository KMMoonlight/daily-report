import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { publishGeneratedContent } from "../src/infrastructure/git-publisher";

const execute = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function git(cwd: string, ...arguments_: string[]) {
  return execute("git", arguments_, { cwd });
}

describe("generated content publisher", () => {
  it("commits and pushes only generated content without force", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-git-"));
    directories.push(root);
    const remote = join(root, "remote.git");
    const repository = join(root, "repository");
    await git(root, "init", "--bare", remote);
    await git(root, "clone", remote, repository);
    await git(repository, "config", "user.name", "Test");
    await git(repository, "config", "user.email", "test@example.com");
    await mkdir(join(repository, "src/content/daily"), { recursive: true });
    await writeFile(join(repository, "README.md"), "seed");
    await git(repository, "add", "README.md");
    await git(repository, "commit", "-m", "seed");
    await git(repository, "push", "-u", "origin", "HEAD:main");
    await git(repository, "checkout", "-B", "main");

    await writeFile(join(repository, "src/content/daily/2026-07-25.md"), "report");
    const result = await publishGeneratedContent(repository, "publish daily 2026-07-25");

    expect(result.pushed).toBe(true);
    expect((await git(repository, "status", "--porcelain")).stdout).toBe("");
  });

  it("refuses unrelated working tree changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "tech-git-"));
    directories.push(root);
    await git(root, "init");
    await git(root, "config", "user.name", "Test");
    await git(root, "config", "user.email", "test@example.com");
    await writeFile(join(root, "package.json"), "{}");

    await expect(publishGeneratedContent(root, "publish")).rejects.toThrow(/outside generated content/);
  });
});
