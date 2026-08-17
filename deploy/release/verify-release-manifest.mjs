import { readFile } from "node:fs/promises";
import process from "node:process";
import { verifySignedReleaseManifest } from "./release-manifest-lib.mjs";

const args = parseArgs(process.argv.slice(2));
for (const required of ["manifest", "public-key", "expected-key-id", "platform"]) {
  if (!args[required]) fail(`Missing --${required}`);
}

try {
  const manifest = JSON.parse(await readFile(args.manifest, "utf8"));
  const publicKey = await readFile(args["public-key"], "utf8");
  const payload = verifySignedReleaseManifest(manifest, publicKey, args["expected-key-id"]);
  const artifact = payload.artifacts.find((candidate) => candidate.platform === args.platform);
  if (!artifact) throw new Error(`release_artifact_missing:${args.platform}`);
  process.stdout.write(`${JSON.stringify({
    version: payload.version,
    minimumMasterVersion: payload.minimumMasterVersion,
    artifact
  })}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value) fail(`Invalid argument near ${key || "end"}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
