import { readFile } from "node:fs/promises";
import path from "node:path";

const file = argument("--file");
if (!file) fail("usage: node scripts/verify-production-acceptance.mjs --file <acceptance.json>");
const input = JSON.parse(await readFile(path.resolve(file), "utf8"));
const failures = [];
const requiredGates = [
  "offlineVerification",
  "bindingVerified",
  "canaryCompleted",
  "riskInterventionCompleted",
  "checkpointResumeCompleted",
  "fullStoreRunCompleted",
  "rawArtifactTraceability",
  "databaseAndExcelTraceability",
  "rollbackTargetVerified"
];

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.release?.tag || "")) failures.push("release.tag");
if (!/^[a-f0-9]{40}$/.test(input.release?.commit || "")) failures.push("release.commit");
if (!String(input.release?.schemaVersion || "").trim()) failures.push("release.schemaVersion");
if (!String(input.operator || "").trim() || String(input.operator).includes("<")) failures.push("operator");
if (!String(input.reviewer || "").trim() || String(input.reviewer).includes("<")) failures.push("reviewer");
if (input.level !== "L4") failures.push("level");
if (!Number.isFinite(Date.parse(input.completedAt || ""))) failures.push("completedAt");
for (const gate of requiredGates) if (input.gates?.[gate] !== true) failures.push(`gates.${gate}`);
if (!Array.isArray(input.evidence) || input.evidence.length === 0) failures.push("evidence");
for (const [index, evidence] of (input.evidence || []).entries()) {
  if (!String(evidence.id || "").trim() || String(evidence.id).includes("<")) failures.push(`evidence[${index}].id`);
  if (!String(evidence.type || "").trim()) failures.push(`evidence[${index}].type`);
  if (!String(evidence.reference || "").trim() || String(evidence.reference).includes("<")) failures.push(`evidence[${index}].reference`);
  if (!/^[a-f0-9]{64}$/.test(evidence.sha256 || "")) failures.push(`evidence[${index}].sha256`);
}

if (failures.length) fail(`production_acceptance_incomplete:${failures.join(",")}`);
process.stdout.write(`${JSON.stringify({ status: "pass", release: input.release, operator: input.operator, reviewer: input.reviewer, level: input.level, evidenceCount: input.evidence.length })}\n`);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
