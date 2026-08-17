import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const bootstrapUrl = new URL("../windows/prepare-worker-ssh.ps1", import.meta.url);

test("Worker SSH bootstrap uses an external public key and configures OpenSSH idempotently", async () => {
  const script = await readFile(bootstrapUrl, "utf8");

  assert.match(script, /\[Parameter\(Mandatory\s*=\s*\$true\)\]\[string\]\$MasterPublicKeyPath/);
  assert.match(script, /OpenSSH\.Server~~~~0\.0\.1\.0/);
  assert.match(script, /administrators_authorized_keys/);
  assert.match(script, /Restart-Service\s+-Name\s+sshd/);
  assert.match(script, /ConvertTo-Json\s+-Compress/);
  assert.doesNotMatch(script, /password\s*=|ssh-ed25519\s+AAAA|192\.168\.100\./i);
});
