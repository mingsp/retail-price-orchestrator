import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { materializeRuntimeDependencyLinks } from "./worker-release-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const version = args.version;
const outputDirectory = resolve(args.output || "deploy/release/out");
if (!version) fail("Usage: pnpm release:worker -- --version 1.2.3 [--output deploy/release/out]");
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) fail(`Invalid semantic version: ${version}`);

await mkdir(outputDirectory, { recursive: true });
const temporaryRoot = await mkdtemp(resolve(".retail-radar-worker-release-"));
const deployed = resolve(temporaryRoot, "payload");
try {
  await run("pnpm", ["--filter", "@retail-orchestrator/worker", "build"]);
  await run("pnpm", ["--config.inject-workspace-packages=true", "--filter", "@retail-orchestrator/worker", "deploy", "--prod", deployed]);
  const packagePath = resolve(deployed, "package.json");
  const deployedPackage = JSON.parse(await readFile(packagePath, "utf8"));
  deployedPackage.version = version;
  deployedPackage.type = "module";
  deployedPackage.scripts = { start: "node dist/index.js" };
  delete deployedPackage.devDependencies;
  delete deployedPackage.optionalDependencies;
  delete deployedPackage.pnpm;
  await writeFile(packagePath, `${JSON.stringify(deployedPackage, null, 2)}\n`);
  await materializeRuntimeDependencyLinks(resolve(deployed, "node_modules"));
  await mkdir(resolve(deployed, "scripts"), { recursive: true });
  await cp(resolve("scripts/native-cdp-store-capture.mjs"), resolve(deployed, "scripts/native-cdp-store-capture.mjs"), { recursive: false });
  await cp(resolve("scripts/lib"), resolve(deployed, "scripts/lib"), { recursive: true });

  const windowsOutput = resolve(outputDirectory, `retail-radar-worker-${version}-windows-x64.zip`);
  const macArmOutput = resolve(outputDirectory, `retail-radar-worker-${version}-macos-arm64.tar.gz`);
  const macX64Output = resolve(outputDirectory, `retail-radar-worker-${version}-macos-x64.tar.gz`);
  await run("tar", ["-a", "-cf", windowsOutput, "-C", deployed, "."]);
  await run("tar", ["-czf", macArmOutput, "-C", deployed, "."]);
  await cp(macArmOutput, macX64Output, { errorOnExist: true, force: false });
  console.log(`Worker release artifacts created in ${outputDirectory}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, commandArgs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, CI: "true" }
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length;) {
    const key = values[index];
    if (key === "--") {
      index += 1;
      continue;
    }
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value) fail(`Invalid argument near ${key || "end"}`);
    parsed[key.slice(2)] = value;
    index += 2;
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
