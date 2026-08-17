import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
if (!args.private || !args.public) {
  fail("Usage: node generate-release-signing-key.mjs --private <path> --public <path>");
}

const privatePath = resolve(args.private);
const publicPath = resolve(args.public);
const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});

await mkdir(dirname(privatePath), { recursive: true });
await mkdir(dirname(publicPath), { recursive: true });
await writeFile(privatePath, privateKey, { encoding: "utf8", flag: "wx", mode: 0o600 });
await writeFile(publicPath, publicKey, { encoding: "utf8", flag: "wx", mode: 0o644 });
console.log(JSON.stringify({ status: "created", publicKeyPath: publicPath }));

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
