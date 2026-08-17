import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { shouldIncludeSourcePath } from "../lib/files.mjs";

test("source package includes current source and excludes local execution assets", () => {
  const included = [
    "README.md",
    "apps/master/src/server.ts",
    "apps/worker/src/native-collector.ts",
    "docs/handoff/00-项目目标与边界.md",
    "handoff/scripts/verify-package.mjs"
  ];
  const excluded = [
    ".git/config",
    ".runtime/native-capture/run.raw.jsonl",
    "apps/worker/.runtime/spool.json",
    "node_modules/pkg/index.js",
    "apps/dashboard/dist/index.html",
    "browser-profiles/account/Default/Cookies",
    "profiles/account/Default/Login Data",
    ".env",
    ".env.production",
    "capture.products.raw.jsonl",
    "result.xlsx",
    "handoff/releases/current.zip",
    "handoff/work/unpacked/file.txt",
    "scripts/__pycache__/tool.pyc"
  ];

  for (const file of included) {
    assert.equal(shouldIncludeSourcePath(file), true, file);
  }
  for (const file of excluded) {
    assert.equal(shouldIncludeSourcePath(file), false, file);
  }
});

test("handoff package version is generated for the build date instead of a stale hardcoded release", async () => {
  const nodeSource = await readFile(new URL("../scripts/build-package.mjs", import.meta.url), "utf8");
  const powershellSource = await readFile(new URL("../scripts/build-package.ps1", import.meta.url), "utf8");
  assert.match(nodeSource, /--package-version/);
  assert.match(nodeSource, /validatePackageVersion/);
  assert.match(powershellSource, /\$PackageVersion/);
  assert.match(powershellSource, /--package-version/);
  assert.doesNotMatch(nodeSource, /2026\.07\.31\.1/);
  assert.doesNotMatch(powershellSource, /handoff-20260731/);
});

test("handoff package exposes operations documents at the top-level reading path", async () => {
  const source = await readFile(new URL("../scripts/build-package.mjs", import.meta.url), "utf8");
  assert.match(source, /path\.join\(repoRoot, "docs", "operations"\)/);
  assert.match(source, /path\.join\(stagingRoot, "docs", "operations"\)/);
});
