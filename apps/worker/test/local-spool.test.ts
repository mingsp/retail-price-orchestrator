import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalSpool } from "../src/local-spool.js";

test("local spool keeps messages until the master acknowledges them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-worker-spool-"));
  const spool = new LocalSpool(path.join(root, "events.jsonl"));

  await spool.enqueue({ idempotencyKey: "risk-001", payload: { type: "risk", code: 403 } });
  await spool.enqueue({ idempotencyKey: "progress-001", payload: { type: "progress", count: 120 } });

  assert.deepEqual(
    (await spool.list()).map((item) => item.idempotencyKey),
    ["risk-001", "progress-001"]
  );

  await spool.acknowledge("risk-001");
  assert.deepEqual(
    (await spool.list()).map((item) => item.idempotencyKey),
    ["progress-001"]
  );

  const reopened = new LocalSpool(path.join(root, "events.jsonl"));
  assert.deepEqual(
    (await reopened.list()).map((item) => item.idempotencyKey),
    ["progress-001"]
  );
});

test("local spool de-duplicates the same idempotency key", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-worker-spool-"));
  const spool = new LocalSpool(path.join(root, "events.jsonl"));

  await spool.enqueue({ idempotencyKey: "quality-001", payload: { status: "warn" } });
  await spool.enqueue({ idempotencyKey: "quality-001", payload: { status: "pass" } });

  const items = await spool.list();
  assert.equal(items.length, 1);
  assert.deepEqual(items[0]?.payload, { status: "warn" });
});
