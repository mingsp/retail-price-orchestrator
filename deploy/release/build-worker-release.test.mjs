import assert from "node:assert/strict";
import { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { materializeRuntimeDependencyLinks } from "./worker-release-lib.mjs";

test("release materializer expands pnpm path reference files", async () => {
  const nodeModules = await mkdtemp(resolve(tmpdir(), "retail-radar-link-file-test-"));
  const packageDirectory = resolve(nodeModules, ".pnpm", "ws@8.21.0", "node_modules", "ws");
  try {
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(resolve(packageDirectory, "package.json"), '{"name":"ws","version":"8.21.0"}\n');
    await writeFile(resolve(packageDirectory, "index.js"), "export default {};\n");
    await writeFile(resolve(nodeModules, "ws"), ".pnpm/ws@8.21.0/node_modules/ws");

    await materializeRuntimeDependencyLinks(nodeModules);

    assert.equal((await lstat(resolve(nodeModules, "ws"))).isDirectory(), true);
    assert.equal(JSON.parse(await readFile(resolve(nodeModules, "ws", "package.json"), "utf8")).name, "ws");
  } finally {
    await rm(nodeModules, { recursive: true, force: true });
  }
});

test("worker release builder creates installable artifacts without runtime profiles", { timeout: 180_000 }, async () => {
  const builder = await readFile("deploy/release/build-worker-release.mjs", "utf8");
  const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
  assert.doesNotMatch(builder, /from "node:os"/);
  assert.match(builder, /mkdtemp\(resolve\("\.retail-radar-worker-release-"\)\)/);
  assert.equal(rootPackage.packageManager, "pnpm@11.21.0");

  const output = await mkdtemp(resolve(tmpdir(), "retail-radar-release-test-"));
  const extracted = await mkdtemp(resolve(tmpdir(), "retail-radar-release-extracted-"));
  const version = "0.0.0-release-test";
  try {
    const result = await run(process.execPath, [
      "deploy/release/build-worker-release.mjs",
      "--",
      "--version",
      version,
      "--output",
      output
    ]);
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`.trim());
    const windowsArtifact = resolve(output, `retail-radar-worker-${version}-windows-x64.zip`);
    await Promise.all([
      access(windowsArtifact),
      access(resolve(output, `retail-radar-worker-${version}-macos-arm64.tar.gz`)),
      access(resolve(output, `retail-radar-worker-${version}-macos-x64.tar.gz`))
    ]);
    const listing = await run("tar", ["-tf", windowsArtifact]);
    assert.equal(listing.code, 0, listing.stderr || listing.stdout);
    assert.match(listing.stdout, /(?:^|\n)\.\/package\.json(?:\r?\n|$)/);
    assert.match(listing.stdout, /(?:^|\n)\.\/dist\/index\.js(?:\r?\n|$)/);
    assert.match(listing.stdout, /(?:^|\n)\.\/scripts\/native-cdp-store-capture\.mjs(?:\r?\n|$)/);
    assert.doesNotMatch(listing.stdout, /(?:^|\/)\.runtime(?:\/|$)/i);
    assert.doesNotMatch(listing.stdout, /chrome-profiles/i);
    assert.doesNotMatch(listing.stdout, /(?:^|\n)\.\/src\//);
    assert.doesNotMatch(listing.stdout, /(?:^|\n)\.\/test\//);
    assert.doesNotMatch(listing.stdout, /node_modules\/@retail-orchestrator\/shared/i);
    const packageResult = await run("tar", ["-xOf", windowsArtifact, "./package.json"]);
    assert.equal(packageResult.code, 0, `${packageResult.stdout}\n${packageResult.stderr}`.trim());
    const releasePackage = JSON.parse(packageResult.stdout);
    assert.equal(releasePackage.type, "module");
    assert.deepEqual(releasePackage.scripts, { start: "node dist/index.js" });
    assert.equal(releasePackage.devDependencies, undefined);
    assert.doesNotMatch(packageResult.stdout, /file:\/\/\//i);
    assert.doesNotMatch(packageResult.stdout, /[A-Za-z]:\\/);
    const extractResult = await run("tar", ["-xf", windowsArtifact, "-C", extracted]);
    assert.equal(extractResult.code, 0, extractResult.stderr || extractResult.stdout);
    const runtimeResolution = await run(process.execPath, ["--input-type=module", "-e", "await import('ws')"], extracted);
    assert.equal(runtimeResolution.code, 0, `${runtimeResolution.stdout}\n${runtimeResolution.stderr}`.trim());
  } finally {
    await rm(output, { recursive: true, force: true });
    await rm(extracted, { recursive: true, force: true });
  }
});

function run(command, args, cwd = resolve(".")) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code, stdout, stderr }));
  });
}
