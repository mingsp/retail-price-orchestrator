import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const excludedSegments = new Set([
  ".git",
  ".publication",
  ".runtime",
  "node_modules",
  "dist",
  "browser-profiles",
  "profiles",
  "__pycache__"
]);

const excludedExtensions = new Set([
  ".csv",
  ".db",
  ".jsonl",
  ".log",
  ".pyc",
  ".sqlite",
  ".xlsx"
]);

const excludedSourceDocuments = new Set([
  "docs/stage-one-two-store-weekly-runbook.md",
  "docs/superpowers/plans/2026-07-08-two-store-weekly-master-worker.md"
]);

export function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function shouldIncludeSourcePath(value) {
  const relativePath = normalizeRelativePath(value);
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) return false;
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.some((segment) => excludedSegments.has(segment))) return false;
  if (segments[0] === "handoff" && ["releases", "work"].includes(segments[1])) return false;
  if (relativePath.startsWith("docs/run-logs/")) return false;
  if (excludedSourceDocuments.has(relativePath)) return false;

  const base = segments.at(-1) || "";
  const lowerBase = base.toLowerCase();
  if (lowerBase === ".env" || (lowerBase.startsWith(".env.") && lowerBase !== ".env.example")) {
    return false;
  }
  if (excludedExtensions.has(path.extname(lowerBase))) return false;
  if (lowerBase === "cookies" || lowerBase === "login data" || lowerBase === "web data") return false;
  return true;
}

export async function listSourceFiles(repoRoot) {
  const root = path.resolve(repoRoot);
  const { stdout } = await execFileAsync(
    "git",
    ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }
  );
  const candidates = stdout
    .toString("utf8")
    .split("\0")
    .map(normalizeRelativePath)
    .filter(shouldIncludeSourcePath)
    .sort((left, right) => left.localeCompare(right, "en"));
  const existing = await Promise.all(
    candidates.map(async (relativePath) => {
      try {
        const stat = await fs.lstat(resolveInside(root, relativePath));
        return stat.isFile() && !stat.isSymbolicLink() ? relativePath : "";
      } catch (error) {
        if (error?.code === "ENOENT") return "";
        throw error;
      }
    })
  );
  return existing.filter(Boolean);
}

export function resolveInside(root, relativePath) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, normalizeRelativePath(relativePath));
  const relative = path.relative(absoluteRoot, target);
  if (!relative || relative === ".") return target;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`path_outside_root:${relativePath}`);
  }
  return target;
}

export async function copyFileSafe(sourceRoot, destinationRoot, relativePath) {
  const source = resolveInside(sourceRoot, relativePath);
  const destination = resolveInside(destinationRoot, relativePath);
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`unsafe_source_file:${relativePath}`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  return destination;
}

export async function sha256File(filePath) {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export async function writeJsonAtomic(filePath, value) {
  const absolute = path.resolve(filePath);
  const temporary = `${absolute}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, absolute);
}

export async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}:${error.message}`);
      }
    });
}

export async function writeJsonl(filePath, rows) {
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  const text = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, text ? `${text}\n` : "", "utf8");
}

export async function listFilesRecursive(root) {
  const absoluteRoot = path.resolve(root);
  const output = [];
  await walk(absoluteRoot, "");
  return output.sort((left, right) => left.localeCompare(right, "en"));

  async function walk(current, relativeDirectory) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = normalizeRelativePath(path.join(relativeDirectory, entry.name));
      const absolutePath = resolveInside(absoluteRoot, relativePath);
      if (entry.isSymbolicLink()) throw new Error(`symlink_not_allowed:${relativePath}`);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        output.push(relativePath);
      }
    }
  }
}

export async function listDeployedSourceFiles(root) {
  const absoluteRoot = path.resolve(root);
  const output = [];
  await walk(absoluteRoot, "");
  return output.sort((left, right) => left.localeCompare(right, "en"));

  async function walk(current, relativeDirectory) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = normalizeRelativePath(path.join(relativeDirectory, entry.name));
      if (isGeneratedOrRuntimePath(relativePath)) continue;
      const absolutePath = resolveInside(absoluteRoot, relativePath);
      if (entry.isSymbolicLink()) throw new Error(`symlink_not_allowed:${relativePath}`);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        output.push(relativePath);
      }
    }
  }
}

function isGeneratedOrRuntimePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => excludedSegments.has(segment))) return true;
  if (segments[0] === "handoff" && ["releases", "work"].includes(segments[1])) return true;
  if (excludedSourceDocuments.has(normalized)) return true;
  return normalized.startsWith("docs/run-logs/");
}
