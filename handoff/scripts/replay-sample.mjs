import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readJsonl } from "../lib/files.mjs";
import { auditSample } from "../lib/sample.mjs";

export async function replaySample(packageRoot) {
  const root = path.resolve(packageRoot);
  const sampleRoot = path.join(root, "examples", "deidentified");
  const rawRows = await readJsonl(path.join(sampleRoot, "capture.products.raw.jsonl"));
  const riskEvents = await readJsonl(path.join(sampleRoot, "risk-events.jsonl"));
  const checkpoint = JSON.parse(
    await fs.readFile(path.join(sampleRoot, "capture.checkpoint.json"), "utf8")
  );
  const expected = JSON.parse(
    await fs.readFile(path.join(sampleRoot, "expected-audit.json"), "utf8")
  );
  const actual = auditSample({ rawRows, checkpoint, riskEvents });
  assert.deepEqual(actual, expected);
  return {
    status: "pass",
    sampleRoot: "examples/deidentified",
    audit: actual
  };
}

if (isMain()) {
  const packageRoot = argument("--package-root") || process.cwd();
  replaySample(packageRoot)
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
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
