import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { renewTaskLease } from "../src/repositories/task-leases.js";

test("lease renewal is fenced by owner and generation", async () => {
  let query = "";
  let params: unknown[] = [];
  const db = {
    async query(sql: string, values: unknown[]) {
      query = sql;
      params = values;
      return { rowCount: 1 };
    }
  } as unknown as Pool;

  const renewed = await renewTaskLease(db, "task-1", "worker-a:boot-1", 7, 120);

  assert.equal(renewed, true);
  assert.match(query, /lease_owner\s*=\s*\$2/);
  assert.match(query, /lease_generation\s*=\s*\$3/);
  assert.deepEqual(params, ["task-1", "worker-a:boot-1", 7, 120]);
});

test("lease renewal reports a lost lease", async () => {
  const db = {
    async query() {
      return { rowCount: 0 };
    }
  } as unknown as Pool;

  assert.equal(await renewTaskLease(db, "task-1", "worker-a:boot-1", 7), false);
});
