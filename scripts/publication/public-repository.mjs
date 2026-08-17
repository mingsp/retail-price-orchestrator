import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  copyFileSafe,
  listDeployedSourceFiles,
  listSourceFiles,
  normalizeRelativePath,
  shouldIncludeSourcePath
} from "../../handoff/lib/files.mjs";
import { scanText } from "../../handoff/lib/redaction.mjs";
import { verifyDocLinks } from "../../handoff/scripts/verify-doc-links.mjs";

const textExtensions = new Set([
  "",
  ".env",
  ".example",
  ".js",
  ".json",
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
const forbiddenExtensions = new Set([".csv", ".db", ".jsonl", ".log", ".sqlite", ".xlsx"]);
const forbiddenSegments = new Set([".runtime", "artifacts", "browser-profiles", "data", "node_modules", "profiles"]);
const fixtureAllowlist = new Set([
  "handoff/test/redaction.test.mjs",
  "handoff/test/public-repository.test.mjs"
]);
const canonicalPhoneFixture = ["138", "0013", "8000"].join("");
const phoneFixtureFiles = new Set([
  "apps/master/test/account-pool.test.ts",
  "apps/master/test/notification-outbox.test.ts",
  "apps/master/test/registry-sync.test.ts",
  "apps/registry-sync/test/account-mapper.test.ts",
  "apps/registry-sync/test/dws-client.test.ts",
  "apps/registry-sync/test/record-mapper.test.ts",
  "apps/registry-sync/test/registry-writeback.test.ts",
  "apps/registry-sync/test/sync-runner.test.ts"
]);
const webhookFixtureFiles = new Set([
  "apps/master/test/config.test.ts",
  "apps/master/test/notification-outbox.test.ts"
]);
const sessionUrlFixtureFiles = new Set([
  "apps/registry-sync/test/record-mapper.test.ts",
  "apps/registry-sync/test/store-mapper.test.ts"
]);
const execFileAsync = promisify(execFile);

export async function buildPublicRepository({ sourceRoot, destinationRoot, candidates }) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  await assertSafeDestination(source, destination);
  const manifest = await readManifest(source);
  const sourceFiles = candidates || await listSourceFiles(source);
  const files = sourceFiles
    .map(normalizeRelativePath)
    .filter((relativePath) => shouldIncludePublicPath(relativePath, manifest))
    .sort((left, right) => left.localeCompare(right, "en"));

  await fs.mkdir(destination, { recursive: true });
  for (const relativePath of files) {
    await copyFileSafe(source, destination, relativePath);
  }

  const verification = await verifyPublicRepository(destination);
  if (verification.status !== "pass") {
    const error = new Error("public_repository_verification_failed");
    error.verification = verification;
    throw error;
  }
  return { sourceRoot: source, destinationRoot: destination, files, verification };
}

export async function verifyPublicRepository(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const manifest = await readManifest(root);
  const allFiles = await listPublicCandidateFiles(root);
  const sourceCheckout = await isGitCheckout(root);
  const files = allFiles.filter((relativePath) =>
    !relativePath.startsWith(".git/") && (!sourceCheckout || shouldIncludePublicPath(relativePath, manifest))
  );
  const forbiddenPaths = files.filter((relativePath) => isForbiddenPublicPath(relativePath));
  const missingRequired = [];
  for (const requiredPath of manifest.requiredPaths || []) {
    try {
      const stat = await fs.stat(path.join(root, requiredPath));
      if (!stat.isFile()) missingRequired.push(requiredPath);
    } catch {
      missingRequired.push(requiredPath);
    }
  }

  const findings = [];
  let scannedFiles = 0;
  for (const relativePath of files) {
    if (fixtureAllowlist.has(relativePath)) continue;
    const extension = path.extname(relativePath).toLowerCase();
    if (!textExtensions.has(extension)) continue;
    const absolutePath = path.join(root, relativePath);
    const stat = await fs.stat(absolutePath);
    if (stat.size > 8 * 1024 * 1024) continue;
    const content = await fs.readFile(absolutePath, "utf8");
    scannedFiles += 1;
    findings.push(
      ...[
        ...scanText(content, relativePath),
        ...scanPublicOnlyRules(content, relativePath)
      ].filter((finding) => !isAllowedPublicFixtureFinding(finding, content, relativePath))
    );
  }

  const uniqueFindings = deduplicateFindings(findings);
  const docLinks = await verifyDocLinks(root);
  const status = forbiddenPaths.length || missingRequired.length || uniqueFindings.length || docLinks.status !== "pass"
    ? "fail"
    : "pass";
  return {
    status,
    fileCount: files.length,
    forbiddenPaths,
    missingRequired,
    redaction: {
      status: uniqueFindings.length ? "fail" : "pass",
      scannedFiles,
      findingCount: uniqueFindings.length,
      findings: uniqueFindings
    },
    docLinks
  };
}

async function isGitCheckout(root) {
  try {
    return (await fs.stat(path.join(root, ".git"))).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isAllowedPublicFixtureFinding(finding, content, source) {
  const line = content.split(/\r?\n/)[Math.max(0, Number(finding.line || 1) - 1)] || "";
  if (
    (finding.ruleId === "full-phone" || finding.ruleId === "bare-mainland-phone") &&
    phoneFixtureFiles.has(source)
  ) {
    const phones = [...line.matchAll(/\b1[3-9]\d{9}\b/gu)].map((match) => match[0]);
    return phones.length > 0 && phones.every((phone) => phone === canonicalPhoneFixture);
  }
  if (
    (finding.ruleId === "dingtalk-access-token" || finding.ruleId === "literal-dingtalk-webhook") &&
    webhookFixtureFiles.has(source)
  ) {
    const tokens = [...line.matchAll(/access_token=([A-Za-z0-9_-]+)/gu)].map((match) => match[1]);
    return tokens.length > 0 && tokens.every((token) =>
      ["REPLACE_BEFORE_GO_LIVE", "example-token", "secret"].includes(token)
    );
  }
  if (finding.ruleId === "meituan-session-url" && sessionUrlFixtureFiles.has(source)) {
    return /response_code=temporary(?:[&"']|$)/u.test(line);
  }
  if (
    (finding.ruleId === "windows-user-path" || finding.ruleId === "absolute-windows-path") &&
    source === "apps/master/test/notification-outbox.test.ts"
  ) {
    return line.includes("C:\\\\Users\\\\ops\\\\profile-01");
  }
  return false;
}

async function listPublicCandidateFiles(root) {
  try {
    const gitDirectory = await fs.stat(path.join(root, ".git"));
    if (gitDirectory.isDirectory()) {
      const { stdout } = await execFileAsync("git", ["-C", root, "ls-files", "-z"], {
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024
      });
      const tracked = stdout.toString("utf8").split("\0").map(normalizeRelativePath).filter(Boolean);
      const existing = await Promise.all(tracked.map(async (relativePath) => {
        try {
          return (await fs.stat(path.join(root, relativePath))).isFile() ? relativePath : undefined;
        } catch (error) {
          if (error?.code === "ENOENT") return undefined;
          throw error;
        }
      }));
      return existing.filter(Boolean);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return listDeployedSourceFiles(root);
}

export function shouldIncludePublicPath(value, manifest = {}) {
  const relativePath = normalizeRelativePath(value);
  if (!shouldIncludeSourcePath(relativePath)) return false;
  if ((manifest.includedPaths || []).includes(relativePath)) return true;
  if ((manifest.excludedPaths || []).includes(relativePath)) return false;
  if ((manifest.excludedPrefixes || []).some((prefix) => relativePath.startsWith(prefix))) return false;
  return true;
}

function isForbiddenPublicPath(value) {
  const relativePath = normalizeRelativePath(value);
  const segments = relativePath.split("/").filter(Boolean);
  const lowerBase = (segments.at(-1) || "").toLowerCase();
  if (segments.some((segment) => forbiddenSegments.has(segment))) return true;
  if (relativePath.startsWith("handoff/releases/") || relativePath.startsWith("handoff/work/")) return true;
  if (relativePath.startsWith("docs/run-logs/")) return true;
  if (lowerBase === ".env" || (lowerBase.startsWith(".env.") && lowerBase !== ".env.example")) return true;
  return forbiddenExtensions.has(path.extname(lowerBase));
}

function scanPublicOnlyRules(content, source) {
  const findings = [];
  const rules = [
    { id: "bare-mainland-phone", regex: /\b1[3-9]\d{9}\b/gu },
    { id: "private-lan-ip", regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/gu },
    { id: "literal-dingtalk-webhook", regex: /https:\/\/oapi\.dingtalk\.com\/robot\/send\?access_token=[A-Za-z0-9_-]+/gu },
    { id: "meituan-session-url", regex: /https:\/\/[^\s"']*meituan\.com\/[^\s"']*(?:request_code|response_code|wm_uuid|wm_visitid|access_token)=[^\s"'&]+/giu }
  ];
  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    for (const match of content.matchAll(rule.regex)) {
      if (isPublicRulePlaceholder(rule.id, match[0], source)) continue;
      const start = match.index || 0;
      const prefix = content.slice(0, start);
      const line = prefix.split(/\r?\n/).length;
      findings.push({ source, ruleId: rule.id, line, column: start - Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("\r")), preview: "<REDACTED>" });
    }
  }
  return findings;
}

function isPublicRulePlaceholder(ruleId, value, source) {
  if (source === ".env.example" && ruleId === "private-lan-ip") return true;
  if (source.endsWith("network-address.test.ts") && ruleId === "private-lan-ip") return true;
  if (source.includes("test/") && ruleId === "private-lan-ip" && /192\.0\.2\.|198\.51\.100\.|203\.0\.113\./.test(value)) return true;
  return /<(?:REDACTED|FULL_LOGIN_PHONE|DB_PASSWORD|TOKEN|WEBHOOK)[^>]*>/i.test(value);
}

function deduplicateFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.source}:${finding.ruleId}:${finding.line}:${finding.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.source.localeCompare(right.source, "en") || left.line - right.line || left.column - right.column);
}

async function readManifest(root) {
  const localManifest = path.join(path.resolve(root), "scripts", "publication", "public-files.json");
  try {
    return JSON.parse(await fs.readFile(localManifest, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { requiredPaths: [], excludedPrefixes: [], excludedPaths: [] };
}

async function assertSafeDestination(source, destination) {
  if (destination === source || destination.startsWith(`${source}${path.sep}`)) {
    if (!destination.includes(`${path.sep}.publication${path.sep}`)) {
      throw new Error("public_destination_must_be_isolated");
    }
  }
  try {
    const entries = await fs.readdir(destination);
    if (entries.length) throw new Error("public_destination_not_empty");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function main() {
  const [command] = process.argv.slice(2);
  if (command === "build") {
    const sourceRoot = argument("--source") || process.cwd();
    const destinationRoot = argument("--destination");
    if (!destinationRoot) throw new Error("missing_--destination");
    const result = await buildPublicRepository({ sourceRoot, destinationRoot });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "verify") {
    const repositoryRoot = argument("--root") || positionalArgument(3) || process.cwd();
    const result = await verifyPublicRepository(repositoryRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "pass") process.exitCode = 1;
    return;
  }
  throw new Error("usage: public-repository.mjs <build|verify> [--source PATH] [--destination PATH] [--root PATH]");
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function positionalArgument(startIndex) {
  return process.argv.slice(startIndex).find((value) => value !== "--" && !value.startsWith("--")) || "";
}

function isMain() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMain()) {
  main().catch((error) => {
    if (error?.verification) process.stderr.write(`${JSON.stringify(error.verification, null, 2)}\n`);
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
