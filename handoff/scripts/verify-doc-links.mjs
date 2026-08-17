import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listFilesRecursive } from "../lib/files.mjs";

export async function verifyDocLinks(packageRoot) {
  const root = path.resolve(packageRoot);
  const handoffDocs = path.join(root, "docs", "handoff");
  const candidates = [
    path.join(root, "README.md"),
    path.join(root, "HANDOFF_START_HERE.md")
  ];
  try {
    const docs = await listFilesRecursive(handoffDocs);
    candidates.push(
      ...docs.filter((file) => file.endsWith(".md")).map((file) => path.join(handoffDocs, file))
    );
  } catch {
    // Required-file validation reports a missing docs directory separately.
  }

  const findings = [];
  let checkedLinks = 0;
  for (const filePath of candidates) {
    if (!(await exists(filePath))) continue;
    const text = await fs.readFile(filePath, "utf8");
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].trim().replace(/^<|>$/g, "");
      if (!target || target.startsWith("#") || /^(?:https?:|mailto:)/i.test(target)) continue;
      if (/^(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/)/.test(target)) {
        findings.push({
          source: path.relative(root, filePath).replaceAll("\\", "/"),
          target,
          reason: "absolute_local_path"
        });
        continue;
      }
      checkedLinks += 1;
      const cleanTarget = decodeURIComponent(target.split("#")[0]);
      const resolved = path.resolve(path.dirname(filePath), cleanTarget);
      if (!(await exists(resolved))) {
        findings.push({
          source: path.relative(root, filePath).replaceAll("\\", "/"),
          target,
          reason: "missing_relative_target"
        });
      }
    }
  }

  return {
    status: findings.length ? "fail" : "pass",
    checkedLinks,
    findingCount: findings.length,
    findings
  };
}

if (isMain()) {
  const packageRoot = argument("--package-root") || process.cwd();
  verifyDocLinks(packageRoot)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.status !== "pass") process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function isMain() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}
