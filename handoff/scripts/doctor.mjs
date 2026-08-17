import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const checks = [];

checks.push(commandCheck("node", process.execPath, ["--version"], true));
checks.push(commandCheck("git", "git", ["--version"], true));
checks.push(commandCheck("pnpm", "pnpm", ["--version"], false));
checks.push(commandCheck("docker", "docker", ["--version"], false));
checks.push(chromeCheck());
checks.push(diskCheck(process.cwd()));
checks.push({
  id: "system-time",
  status: "pass",
  message: new Date().toISOString()
});

if (args.config) checks.push(...configChecks(args.config));
if (args.network) checks.push(await networkCheck(args.network));

const result = {
  generatedAt: new Date().toISOString(),
  mode: args.network ? "read-only-with-network-health-check" : "offline-read-only",
  platform: process.platform,
  arch: process.arch,
  cwd: "<LOCAL_PROJECT_ROOT>",
  summary: summarize(checks),
  checks
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  for (const check of checks) {
    process.stdout.write(`[${check.status.toUpperCase()}] ${check.id}: ${check.message}\n`);
  }
  process.stdout.write(`Summary: ${JSON.stringify(result.summary)}\n`);
}

process.exitCode = result.summary.fail > 0 ? 1 : 0;

function commandCheck(id, command, commandArgs, required) {
  const execution = spawnSync(command, commandArgs, {
    encoding: "utf8",
    shell: process.platform === "win32" && !path.isAbsolute(command),
    windowsHide: true,
    timeout: 10_000
  });
  if (execution.status === 0) {
    return {
      id,
      status: "pass",
      message: firstLine(execution.stdout || execution.stderr || "available")
    };
  }
  return {
    id,
    status: required ? "fail" : "warn",
    message: required ? "required command unavailable" : "optional command unavailable"
  };
}

function chromeCheck() {
  const candidates = process.platform === "win32"
    ? [
        path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] || "", "Google/Chrome/Application/chrome.exe"),
        path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  return {
    id: "chrome",
    status: found ? "pass" : "warn",
    message: found ? "Google Chrome detected" : "Chrome not found in standard locations"
  };
}

function diskCheck(target) {
  try {
    const stat = fs.statfsSync(target);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    return {
      id: "disk-free",
      status: freeBytes >= 5 * 1024 ** 3 ? "pass" : "warn",
      message: `${(freeBytes / 1024 ** 3).toFixed(1)} GiB free`
    };
  } catch {
    return { id: "disk-free", status: "warn", message: "unable to read free space" };
  }
}

function configChecks(configPath) {
  const absolute = path.resolve(configPath);
  if (!fs.existsSync(absolute)) {
    return [{ id: "config-file", status: "fail", message: "config file not found" }];
  }
  const text = fs.readFileSync(absolute, "utf8");
  const names = new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1])
      .filter(Boolean)
  );
  const required = ["MASTER_BASE_URL"];
  return [
    { id: "config-file", status: "pass", message: "config file is readable" },
    ...required.map((name) => ({
      id: `config:${name}`,
      status: names.has(name) ? "pass" : "warn",
      message: names.has(name) ? "variable name present" : "variable name absent"
    }))
  ];
}

async function networkCheck(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10_000)
    });
    return {
      id: "network-health",
      status: response.ok ? "pass" : "warn",
      message: `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      id: "network-health",
      status: "warn",
      message: `network check failed: ${error.name}`
    };
  }
}

function summarize(items) {
  return items.reduce(
    (summary, item) => {
      summary[item.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 }
  );
}

function firstLine(value) {
  return String(value).trim().split(/\r?\n/)[0].slice(0, 160);
}

function parseArgs(values) {
  const output = { json: false, config: "", network: "" };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--json") output.json = true;
    if (values[index] === "--config") output.config = values[++index] || "";
    if (values[index] === "--network") output.network = values[++index] || "";
  }
  return output;
}
