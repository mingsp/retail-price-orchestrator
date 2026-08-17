import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPublicRepository,
  verifyPublicRepository
} from "../../scripts/publication/public-repository.mjs";

test("public repository exporter copies allowlisted source without Git history or runtime assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-public-source-"));
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), "retail-public-output-"));
  await write(path.join(root, "README.md"), "# public\n");
  await write(path.join(root, "apps", "worker", "index.ts"), "export const ready = true;\n");
  await write(path.join(root, ".runtime", "capture.jsonl"), "{}\n");
  await write(path.join(root, "profiles", "Login Data"), "secret\n");
  await write(path.join(root, ".git", "config"), "credential = secret\n");

  const result = await buildPublicRepository({
    sourceRoot: root,
    destinationRoot: destination,
    candidates: [
      "README.md",
      "apps/worker/index.ts",
      ".runtime/capture.jsonl",
      "profiles/Login Data",
      ".git/config"
    ]
  });

  assert.deepEqual(new Set(result.files), new Set(["README.md", "apps/worker/index.ts"]));
  assert.equal(await exists(path.join(destination, "README.md")), true);
  assert.equal(await exists(path.join(destination, ".git", "config")), false);
  assert.equal(await exists(path.join(destination, ".runtime", "capture.jsonl")), false);
});

test("public repository verifier rejects secrets identities local paths and production artifacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-public-verify-"));
  await write(path.join(root, "README.md"), "password=Sietium@123\nphone=13800138000\npath=C:\\Users\\Operator\\data\n");
  await write(path.join(root, "capture.jsonl"), "{}\n");
  await write(path.join(root, ".env"), "TOKEN=secret\n");

  const result = await verifyPublicRepository(root);

  assert.equal(result.status, "fail");
  assert.ok(result.forbiddenPaths.includes(".env"));
  assert.ok(result.forbiddenPaths.includes("capture.jsonl"));
  assert.ok(result.redaction.findingCount >= 2);
});

test("public repository verifier accepts placeholders and deidentified documentation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-public-clean-"));
  await write(path.join(root, "README.md"), "phone=<FULL_LOGIN_PHONE>\npassword=<DB_PASSWORD>\n");
  await write(path.join(root, ".env.example"), "DATABASE_PASSWORD=<DB_PASSWORD>\n");

  const result = await verifyPublicRepository(root);

  assert.equal(result.status, "pass");
  assert.deepEqual(result.forbiddenPaths, []);
  assert.equal(result.redaction.findingCount, 0);
});

test("public repository verifier ignores installed dependencies in unpacked snapshots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-public-installed-"));
  await write(path.join(root, "README.md"), "public source\n");
  await write(path.join(root, "node_modules", "dependency", "fixture.js"), "password=third-party-fixture\n");

  const result = await verifyPublicRepository(root);

  assert.equal(result.status, "pass");
  assert.equal(result.redaction.findingCount, 0);
});

test("public repository verifier allows only explicit canonical fixtures in exact test files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-public-fixtures-"));
  await write(
    path.join(root, "apps", "master", "test", "account-pool.test.ts"),
    'const phone = "13800138000";\n'
  );
  await write(
    path.join(root, "apps", "master", "test", "config.test.ts"),
    'const webhook = "https://oapi.dingtalk.com/robot/send?access_token=example-token";\n'
  );
  await write(
    path.join(root, "apps", "registry-sync", "test", "store-mapper.test.ts"),
    'const url = "https://cactivityapi-sc.waimai.meituan.com/h5/sub-trade/restaurant/restaurant?poi_id_str=sample&response_code=temporary";\n'
  );

  const result = await verifyPublicRepository(root);

  assert.equal(result.status, "pass");
  assert.equal(result.redaction.findingCount, 0);
});

test("public repository verifier does not generalize fixture exceptions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-public-fixture-reject-"));
  await write(path.join(root, "apps", "master", "src", "account.ts"), 'const phone = "13800138000";\n');
  await write(path.join(root, "apps", "master", "test", "account-pool.test.ts"), 'const phone = "13800138001";\n');

  const result = await verifyPublicRepository(root);

  assert.equal(result.status, "fail");
  assert.ok(result.redaction.findingCount >= 2);
});

test("public repository homepage is business-first and does not publish a license", async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
  const readme = await fs.readFile(path.join(repositoryRoot, "README.md"), "utf8");
  const packageJson = JSON.parse(await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  const publicationManifest = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, "scripts", "publication", "public-files.json"), "utf8")
  );

  assert.match(readme, /^## 业务目标$/m);
  assert.match(readme, /^## 技术栈$/m);
  assert.doesNotMatch(readme, /License:|^## 许可证$/m);
  assert.equal(Object.hasOwn(packageJson, "license"), false);
  assert.equal(publicationManifest.requiredPaths.includes("LICENSE"), false);
  assert.equal(await exists(path.join(repositoryRoot, "LICENSE")), false);
});

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
