import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const label = "com.tech-daily-weekly.publisher";
const plistPath = resolve(homedir(), "Library/LaunchAgents", `${label}.plist`);
const root = process.cwd();
const tsxCli = resolve(root, "node_modules/tsx/dist/cli.mjs");
const schedulerCli = resolve(root, "src/cli/scheduler.ts");

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function bootout() {
  await execute("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, plistPath]).catch(() => undefined);
}

if (process.argv.includes("--uninstall")) {
  await bootout();
  await rm(plistPath, { force: true });
  process.stdout.write(`Removed ${plistPath}\n`);
} else {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(tsxCli)}</string>
    <string>${xml(schedulerCli)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>StandardOutPath</key><string>${xml(resolve(root, ".data/launchd.stdout.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(resolve(root, ".data/launchd.stderr.log"))}</string>
</dict>
</plist>
`;
  await Promise.all([mkdir(dirname(plistPath), { recursive: true }), mkdir(resolve(root, ".data"), { recursive: true })]);
  await bootout();
  await writeFile(plistPath, plist);
  await execute("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, plistPath]);
  process.stdout.write(`Installed ${plistPath}\n`);
}
