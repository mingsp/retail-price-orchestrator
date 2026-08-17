import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  listFilesRecursive,
  sha256File
} from "../lib/files.mjs";
import { replaySample } from "./replay-sample.mjs";
import { verifyDocLinks } from "./verify-doc-links.mjs";
import { verifyRedaction } from "./verify-redaction.mjs";

const requiredFiles = [
  "AGENTS.md",
  "HANDOFF_START_HERE.md",
  "START_WITH_THIS_PROMPT.md",
  "README.md",
  "VERSION",
  "MANIFEST.json",
  "SHA256SUMS.txt",
  "project/package.json",
  "project/scripts/native-cdp-store-capture.mjs",
  "docs/handoff/00-项目目标与边界.md",
  "docs/handoff/13-资产来源与替代关系.md",
  "docs/handoff/14-账号风控Profile与登录操作手册.md",
  "docs/handoff/15-新人演练与独立操作验收.md",
  "docs/handoff/16-Codex提示词手册与模板.md",
  "config/templates/master.env.example",
  "config/templates/risk-event.example.json",
  "config/templates/account-profile-lifecycle.example.json",
  "config/templates/account-contact-map.example.json",
  "config/templates/codex-task-brief.example.md",
  "examples/deidentified/capture.products.raw.jsonl",
  "examples/deidentified/expected-audit.json",
  "scripts/handoff/verify-package.mjs",
  "scripts/lib/redaction.mjs",
  "reports/source-provenance.json"
];

export async function verifyPackage(packageRoot) {
  const root = path.resolve(packageRoot);
  const files = await listFilesRecursive(root);
  const fileSet = new Set(files);
  const missingRequired = requiredFiles.filter((file) => !fileSet.has(file));
  const forbidden = files.filter(isForbiddenPackagePath);
  const manifest = JSON.parse(await fs.readFile(path.join(root, "MANIFEST.json"), "utf8"));
  const manifestFiles = new Map(manifest.files.map((file) => [file.path, file]));
  const manifestExcluded = new Set(["MANIFEST.json", "SHA256SUMS.txt"]);
  const unexpected = files.filter(
    (file) => !manifestExcluded.has(file) && !manifestFiles.has(file)
  );
  const missingFromDisk = [...manifestFiles.keys()].filter((file) => !fileSet.has(file));
  const hashMismatches = [];

  for (const [relativePath, expected] of manifestFiles) {
    if (!fileSet.has(relativePath)) continue;
    const absolutePath = path.join(root, relativePath);
    const stat = await fs.stat(absolutePath);
    const sha256 = await sha256File(absolutePath);
    if (stat.size !== expected.size || sha256 !== expected.sha256) {
      hashMismatches.push({
        path: relativePath,
        expectedSize: expected.size,
        actualSize: stat.size,
        expectedSha256: expected.sha256,
        actualSha256: sha256
      });
    }
  }

  const redaction = await verifyRedaction(root);
  const docLinks = await verifyDocLinks(root);
  const sampleReplay = await replaySample(root);
  const failures = {
    missingRequired,
    forbidden,
    unexpected,
    missingFromDisk,
    hashMismatches,
    redaction: redaction.findings,
    docLinks: docLinks.findings
  };
  const failed = Object.values(failures).some((value) => value.length > 0);
  assert.equal(sampleReplay.status, "pass");

  return {
    status: failed ? "fail" : "pass",
    packageRoot: "<PACKAGE_ROOT>",
    fileCount: files.length,
    manifestFileCount: manifest.files.length,
    failures,
    redaction: {
      status: redaction.status,
      scannedFiles: redaction.scannedFiles,
      findingCount: redaction.findingCount
    },
    docLinks: {
      status: docLinks.status,
      checkedLinks: docLinks.checkedLinks,
      findingCount: docLinks.findingCount
    },
    sampleReplay
  };
}

if (isMain()) {
  const packageRoot = argument("--package-root") || process.cwd();
  verifyPackage(packageRoot)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.status !== "pass") process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

function isForbiddenPackagePath(relativePath) {
  const segments = relativePath.split("/");
  if (segments.some((segment) => [".git", ".runtime", "node_modules", "dist", "profiles", "browser-profiles"].includes(segment))) {
    return true;
  }
  if (/^project\/.*\/\.env(?:\.|$)/i.test(relativePath) && !relativePath.endsWith(".env.example")) {
    return true;
  }
  if (relativePath.endsWith(".xlsx")) return true;
  if (relativePath.endsWith(".jsonl") && !relativePath.startsWith("examples/deidentified/")) {
    return true;
  }
  return false;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function isMain() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}
