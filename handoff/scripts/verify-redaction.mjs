import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listDeployedSourceFiles, listFilesRecursive, listSourceFiles } from "../lib/files.mjs";
import { scanText } from "../lib/redaction.mjs";

const textExtensions = new Set([
  "",
  ".env",
  ".example",
  ".js",
  ".json",
  ".jsonl",
  ".md",
  ".mjs",
  ".ps1",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

const fixtureAllowlist = new Set([
  "handoff/test/redaction.test.mjs",
  "handoff/test/public-repository.test.mjs",
  "apps/master/test/config.test.ts",
  "apps/master/test/registry-sync.test.ts",
  "apps/registry-sync/test/account-mapper.test.ts",
  "apps/registry-sync/test/dws-client.test.ts",
  "apps/registry-sync/test/sync-runner.test.ts"
]);

export async function verifyRedaction(packageRoot) {
  const root = path.resolve(packageRoot);
  const files = (await isSourceRepository(root))
    ? await listSourceFiles(root)
    : (await isDeployedSource(root))
      ? await listDeployedSourceFiles(root)
      : await listFilesRecursive(root);
  const findings = [];
  let scannedFiles = 0;

  for (const relativePath of files) {
    if (fixtureAllowlist.has(normalizeFixturePath(relativePath))) continue;
    const extension = path.extname(relativePath).toLowerCase();
    if (!textExtensions.has(extension)) continue;
    const absolutePath = path.join(root, relativePath);
    const stat = await fs.stat(absolutePath);
    if (stat.size > 8 * 1024 * 1024) continue;
    const text = await fs.readFile(absolutePath, "utf8");
    scannedFiles += 1;
    findings.push(...scanText(text, relativePath));
  }

  return {
    status: findings.length ? "fail" : "pass",
    scannedFiles,
    findingCount: findings.length,
    findings
  };
}

function normalizeFixturePath(relativePath) {
  return relativePath.startsWith("project/") ? relativePath.slice("project/".length) : relativePath;
}

async function isSourceRepository(root) {
  try {
    await fs.lstat(path.join(root, ".git"));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function isDeployedSource(root) {
  return (await exists(path.join(root, "package.json"))) && (await exists(path.join(root, "pnpm-workspace.yaml")));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

if (isMain()) {
  const packageRoot = argument("--package-root") || process.cwd();
  verifyRedaction(packageRoot)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.status !== "pass") process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function isMain() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}
