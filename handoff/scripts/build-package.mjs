import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  copyFileSafe,
  listFilesRecursive,
  listSourceFiles,
  normalizeRelativePath,
  resolveInside,
  sha256File,
  writeJsonAtomic
} from "../lib/files.mjs";
import { buildDeidentifiedSample } from "../lib/sample.mjs";
import { verifyPackage } from "./verify-package.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");

async function main() {
  const sampleSourceRoot = requiredArgument("--sample-source-root");
  const dateStamp = new Date().toISOString().slice(0, 10);
  const releaseName =
    argument("--release-name") || `retail-price-orchestrator-handoff-${dateStamp.replaceAll("-", "")}`;
  const packageVersion = argument("--package-version") || `${dateStamp.replaceAll("-", ".")}.1`;
  const sourceValidation = argument("--source-validation");
  validateReleaseName(releaseName);
  validatePackageVersion(packageVersion);

  const releaseBase = path.join(repoRoot, "handoff", "releases");
  const workBase = path.join(repoRoot, "handoff", "work");
  const stagingRoot = resolveInside(workBase, `${releaseName}.staging`);
  const finalRoot = resolveInside(releaseBase, releaseName);

  await fs.mkdir(releaseBase, { recursive: true });
  await fs.mkdir(workBase, { recursive: true });
  await removeDirectChild(workBase, stagingRoot);
  await fs.mkdir(stagingRoot, { recursive: true });

  const startedAt = new Date().toISOString();
  const sourceFiles = await listSourceFiles(repoRoot);
  const sourceProvenance = [];
  for (const relativePath of sourceFiles) {
    const destinationRelative = normalizeRelativePath(path.join("project", relativePath));
    const source = resolveInside(repoRoot, relativePath);
    const projectDestination = resolveInside(stagingRoot, destinationRelative);
    await fs.mkdir(path.dirname(projectDestination), { recursive: true });
    await fs.copyFile(source, projectDestination);
    const stat = await fs.stat(projectDestination);
    sourceProvenance.push({
      path: destinationRelative,
      size: stat.size,
      sha256: await sha256File(projectDestination)
    });
  }

  await copySelected(repoRoot, stagingRoot, [
    ["AGENTS.md", "AGENTS.md"],
    ["HANDOFF_START_HERE.md", "HANDOFF_START_HERE.md"],
    ["START_WITH_THIS_PROMPT.md", "START_WITH_THIS_PROMPT.md"]
  ]);
  await copyDirectory(
    path.join(repoRoot, "docs", "handoff"),
    path.join(stagingRoot, "docs", "handoff")
  );
  await copyDirectory(
    path.join(repoRoot, "docs", "operations"),
    path.join(stagingRoot, "docs", "operations")
  );
  await copyDirectory(
    path.join(repoRoot, "handoff", "config", "templates"),
    path.join(stagingRoot, "config", "templates")
  );
  await copyDirectory(
    path.join(repoRoot, "handoff", "scripts"),
    path.join(stagingRoot, "scripts", "handoff")
  );
  await copyDirectory(
    path.join(repoRoot, "handoff", "lib"),
    path.join(stagingRoot, "scripts", "lib")
  );

  await fs.writeFile(path.join(stagingRoot, "VERSION"), `${packageVersion}\n`, "utf8");
  await fs.writeFile(path.join(stagingRoot, "README.md"), packageReadme(), "utf8");
  await fs.mkdir(path.join(stagingRoot, "reports"), { recursive: true });
  await writeJsonAtomic(path.join(stagingRoot, "reports", "source-provenance.json"), {
    generatedAt: startedAt,
    source: "git ls-files -co --exclude-standard with handoff deny rules",
    fileCount: sourceProvenance.length,
    files: sourceProvenance
  });

  let sourceValidationIncluded = false;
  if (sourceValidation) {
    const validationPath = path.resolve(sourceValidation);
    const stat = await fs.stat(validationPath);
    if (!stat.isFile()) throw new Error("source_validation_not_file");
    await fs.copyFile(
      validationPath,
      path.join(stagingRoot, "reports", "source-validation.json")
    );
    sourceValidationIncluded = true;
  }

  const sample = await buildDeidentifiedSample({
    sourceRoot: path.resolve(sampleSourceRoot),
    outputRoot: path.join(stagingRoot, "examples", "deidentified")
  });

  await writeJsonAtomic(path.join(stagingRoot, "reports", "build-report.json"), {
    status: "built",
    version: packageVersion,
    releaseName,
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceFiles: sourceProvenance.length,
    sourceValidationIncluded,
    sample
  });

  await writeManifest(stagingRoot, packageVersion);
  const firstVerification = await verifyPackage(stagingRoot);
  if (firstVerification.status !== "pass") {
    throw new Error(`package_verification_failed:${JSON.stringify(firstVerification.failures)}`);
  }
  await writeJsonAtomic(
    path.join(stagingRoot, "reports", "package-verification.json"),
    firstVerification
  );
  await writeManifest(stagingRoot, packageVersion);
  const finalVerification = await verifyPackage(stagingRoot);
  if (finalVerification.status !== "pass") {
    throw new Error(`final_package_verification_failed:${JSON.stringify(finalVerification.failures)}`);
  }

  await removeDirectChild(releaseBase, finalRoot);
  await fs.rename(stagingRoot, finalRoot);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        releaseName,
        version: packageVersion,
        releaseRoot: finalRoot,
        sourceFileCount: sourceProvenance.length,
        sample: sample.expectedAudit,
        verification: finalVerification
      },
      null,
      2
    )}\n`
  );
}

async function copySelected(sourceRoot, destinationRoot, mappings) {
  for (const [sourceRelative, destinationRelative] of mappings) {
    const source = resolveInside(sourceRoot, sourceRelative);
    const destination = resolveInside(destinationRoot, destinationRelative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
}

async function copyDirectory(sourceRoot, destinationRoot) {
  const files = await listFilesRecursive(sourceRoot);
  for (const relativePath of files) {
    await copyFileSafe(sourceRoot, destinationRoot, relativePath);
  }
}

async function writeManifest(root, packageVersion) {
  const excluded = new Set(["MANIFEST.json", "SHA256SUMS.txt"]);
  const files = (await listFilesRecursive(root)).filter((file) => !excluded.has(file));
  const entries = [];
  for (const relativePath of files) {
    const absolutePath = resolveInside(root, relativePath);
    const stat = await fs.stat(absolutePath);
    entries.push({
      path: relativePath,
      size: stat.size,
      sha256: await sha256File(absolutePath)
    });
  }
  const manifestPath = path.join(root, "MANIFEST.json");
  await writeJsonAtomic(manifestPath, {
    schemaVersion: 1,
    packageVersion,
    generatedAt: new Date().toISOString(),
    fileCount: entries.length,
    files: entries
  });
  const manifestHash = await sha256File(manifestPath);
  const lines = [
    ...entries.map((entry) => `${entry.sha256}  ${entry.path}`),
    `${manifestHash}  MANIFEST.json`
  ];
  await fs.writeFile(path.join(root, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
}

async function removeDirectChild(parent, target) {
  const parentAbsolute = path.resolve(parent);
  const targetAbsolute = path.resolve(target);
  if (path.dirname(targetAbsolute) !== parentAbsolute) {
    throw new Error(`unsafe_remove_target:${targetAbsolute}`);
  }
  await fs.rm(targetAbsolute, { recursive: true, force: true });
}

function packageReadme() {
  return [
    "# 商圈比价采集系统可执行交接包",
    "",
    "从 `HANDOFF_START_HERE.md` 开始。新人执行完整门店时复制 `START_WITH_THIS_PROMPT.md`。",
    "不要先启动浏览器、连接生产数据库或恢复历史任务。",
    "",
    "推荐顺序：",
    "",
    "1. 阅读根目录 `AGENTS.md` 和 `HANDOFF_START_HERE.md`。",
    "2. 阅读并填写 `START_WITH_THIS_PROMPT.md`。",
    "3. 运行 `node scripts/handoff/verify-package.mjs --package-root .`。",
    "4. 运行 `node scripts/handoff/doctor.mjs --json`。",
    "5. 复制 `config/templates/` 中的模板到包外私密配置目录。",
    "6. 使用 `examples/deidentified/` 做离线回放。",
    "7. 完成现场 L3/L4 验证后再接入真实 Worker、CDP 和采集任务。",
    "",
    "本包不包含账号凭据、Cookie、Profile、Webhook、数据库密码、SSH 密钥或未脱敏生产数据。",
    ""
  ].join("\n");
}

function validateReleaseName(value) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error("invalid_release_name");
}

function validatePackageVersion(value) {
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(value)) throw new Error("invalid_package_version");
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`missing_argument:${name}`);
  return value;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
