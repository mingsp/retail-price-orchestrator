import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";
import { assertHttpsUrl, createSignedReleaseManifest } from "./release-manifest-lib.mjs";

const args = parseArgs(process.argv.slice(2));

for (const required of ["version", "minimum-master-version", "base-url", "output", "private-key", "key-id"]) {
  if (!args[required]) fail(`Missing --${required}`);
}
const artifactSpecs = Array.isArray(args.artifact) ? args.artifact : args.artifact ? [args.artifact] : [];
if (artifactSpecs.length === 0) fail("At least one --artifact platform=path is required");

const baseUrl = assertHttpsUrl(String(args["base-url"]).replace(/\/$/, ""), "release_base_url").replace(/\/$/, "");
const artifacts = [];
for (const spec of artifactSpecs) {
  const separator = String(spec).indexOf("=");
  if (separator < 1) fail(`Invalid artifact specification: ${spec}`);
  const platform = String(spec).slice(0, separator);
  const filePath = resolve(String(spec).slice(separator + 1));
  const body = await readFile(filePath);
  artifacts.push({
    platform,
    url: `${baseUrl}/${encodeURIComponent(basename(filePath))}`,
    sha256: createHash("sha256").update(body).digest("hex"),
    sizeBytes: body.byteLength
  });
}

const payload = {
  version: String(args.version),
  minimumMasterVersion: String(args["minimum-master-version"]),
  generatedAt: new Date().toISOString(),
  artifacts
};
const privateKey = await readFile(resolve(String(args["private-key"])), "utf8");
const manifest = createSignedReleaseManifest(payload, privateKey, String(args["key-id"]));
await writeFile(resolve(String(args.output)), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(`Release manifest created: ${resolve(String(args.output))}`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === "--") continue;
    if (!key.startsWith("--")) fail(`Unexpected argument: ${key}`);
    const name = key.slice(2);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    index += 1;
    if (name === "artifact") {
      parsed[name] = [...(parsed[name] || []), value];
    } else {
      parsed[name] = value;
    }
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
