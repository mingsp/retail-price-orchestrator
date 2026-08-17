import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  sanitizeCaptureRecord,
  scanText
} from "../lib/redaction.mjs";
import { verifyRedaction } from "../scripts/verify-redaction.mjs";

const execFileAsync = promisify(execFile);

test("scanText detects credentials, personal paths, and full phone numbers", () => {
  const text = [
    "phone=13800138000",
    "DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=secret-token-value",
    "Cookie: token=abc",
    "Authorization: Bearer secret",
    "profile=C:\\Users\\alice\\Chrome\\Profile 1",
    "home=/Users/alice/Library/Application Support/Chrome",
    "-----BEGIN PRIVATE KEY-----"
  ].join("\n");

  const ids = new Set(scanText(text, "fixture.txt").map((finding) => finding.ruleId));
  assert.deepEqual(
    ids,
    new Set([
      "full-phone",
      "dingtalk-access-token",
      "cookie-header",
      "authorization-header",
      "windows-user-path",
      "mac-user-path",
      "private-key"
    ])
  );
});

test("scanText accepts explicit placeholders and sample identities", () => {
  const text = [
    "DINGTALK_WEBHOOK_URL=<DINGTALK_WEBHOOK_URL>",
    "RETAILMART_DB_PASSWORD=<RETAILMART_DB_PASSWORD>",
    "accountId=sample-account-01",
    "maskedLogin=138****0000",
    "profileId=sample-profile-01",
    "Authorization: Bearer <worker-token>",
    "Authorization: Bearer $WORKER_TOKEN",
    "cookie: 1.1.1"
  ].join("\n");

  assert.deepEqual(scanText(text, "template.env"), []);
});

test("sanitizeCaptureRecord removes transport secrets and stabilizes identities", () => {
  const input = {
    worker: { workerId: "mm-worker", hostname: "private-host" },
    account: {
      accountId: "real-account",
      accountLabel: "张三 13800138000",
      profileId: "real-profile",
      profilePath: "C:\\Users\\alice\\profiles\\real",
      cdpPort: 9421
    },
    store: {
      storeId: "real-store",
      storeName: "真实门店",
      url: "https://example.test/store?request_code=secret"
    },
    requestCode: "secret-request",
    authorization: "Bearer secret",
    productRaw: {
      id: 1001,
      name: "示例商品",
      skus: [{ id: 2001, price: 9.9 }]
    }
  };

  const output = sanitizeCaptureRecord(input);
  assert.equal(output.worker.workerId, "sample-worker-01");
  assert.equal(output.account.accountId, "sample-account-01");
  assert.equal(output.account.accountLabel, "sample-account-01");
  assert.equal(output.account.profileId, "sample-profile-01");
  assert.equal(output.account.profilePath, "<REDACTED_PROFILE_PATH>");
  assert.equal(output.account.cdpPort, 19221);
  assert.equal(output.store.storeId, "sample-store-01");
  assert.equal(output.store.storeName, "脱敏示例门店");
  assert.equal(output.store.url, "https://example.invalid/store/sample-store-01");
  assert.equal(output.requestCode, undefined);
  assert.equal(output.authorization, undefined);
  assert.equal(output.productRaw.name, "示例商品");
});

test("source redaction verification excludes generated publication trees", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-redaction-source-"));
  try {
    await execFileAsync("git", ["init", "--quiet", root]);
    await fs.writeFile(path.join(root, "safe.md"), "maskedLogin=138****0000\n", "utf8");
    await fs.mkdir(path.join(root, ".publication", "generated"), { recursive: true });
    await fs.writeFile(path.join(root, ".publication", "generated", "runtime.txt"), "phone=13800138000\n", "utf8");

    const result = await verifyRedaction(root);
    assert.equal(result.status, "pass");
    assert.equal(result.scannedFiles, 1);

    await fs.writeFile(path.join(root, "danger.md"), "phone=13800138000\n", "utf8");
    const unsafeResult = await verifyRedaction(root);
    assert.equal(unsafeResult.status, "fail");
    assert.equal(unsafeResult.findings[0]?.source, "danger.md");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("package redaction verification normalizes project fixture paths without weakening other files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-redaction-package-"));
  try {
    const fixture = path.join(root, "project", "apps", "master", "test", "config.test.ts");
    await fs.mkdir(path.dirname(fixture), { recursive: true });
    await fs.writeFile(
      fixture,
      "const webhook = 'https://oapi.dingtalk.com/robot/send?access_token=example-token';\n",
      "utf8",
    );
    assert.equal((await verifyRedaction(root)).status, "pass");

    await fs.writeFile(path.join(root, "project", "danger.md"), "phone=13800138000\n", "utf8");
    const unsafeResult = await verifyRedaction(root);
    assert.equal(unsafeResult.status, "fail");
    assert.equal(unsafeResult.findings[0]?.source, "project/danger.md");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("redaction verification allows full-phone fixtures only in the exact registry sync test", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-redaction-registry-fixture-"));
  try {
    const fixture = path.join(
      root,
      "project",
      "apps",
      "registry-sync",
      "test",
      "sync-runner.test.ts"
    );
    await fs.mkdir(path.dirname(fixture), { recursive: true });
    await fs.writeFile(fixture, "const phone = '13800138000';\n", "utf8");
    assert.equal((await verifyRedaction(root)).status, "pass");

    await fs.writeFile(path.join(root, "project", "runtime.md"), "phone=13800138000\n", "utf8");
    const unsafeResult = await verifyRedaction(root);
    assert.equal(unsafeResult.status, "fail");
    assert.equal(unsafeResult.findings[0]?.source, "project/runtime.md");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("deployed source redaction skips generated dependency links but still scans project assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-redaction-deployed-source-"));
  try {
    await fs.writeFile(path.join(root, "package.json"), "{}\n", "utf8");
    await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
    const dependencyTarget = path.join(root, "dependency-target");
    const nodeModules = path.join(root, "node_modules");
    await fs.mkdir(dependencyTarget);
    await fs.mkdir(nodeModules);
    await fs.symlink(dependencyTarget, path.join(nodeModules, "generated-link"), "junction");
    const historicalDoc = path.join(root, "docs", "stage-one-two-store-weekly-runbook.md");
    await fs.mkdir(path.dirname(historicalDoc), { recursive: true });
    await fs.writeFile(historicalDoc, "profile=C:\\Users\\legacy\\Chrome\\Profile 1\n", "utf8");
    assert.equal((await verifyRedaction(root)).status, "pass");

    await fs.writeFile(path.join(root, "runtime.md"), "phone=13800138000\n", "utf8");
    const unsafeResult = await verifyRedaction(root);
    assert.equal(unsafeResult.status, "fail");
    assert.equal(unsafeResult.findings[0]?.source, "runtime.md");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
