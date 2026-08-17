import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backup = await readFile(new URL("../windows/backup-master.ps1", import.meta.url), "utf8");
const restore = await readFile(new URL("../windows/restore-drill.ps1", import.meta.url), "utf8");

test("backup captures PostgreSQL and a consistent versioned MinIO volume", () => {
  assert.match(backup, /pg_dump/);
  assert.match(backup, /docker\.exe pause \$minioContainer/);
  assert.match(backup, /minio-data\.tar/);
  assert.match(backup, /criticalTableCounts/);
  assert.match(backup, /Get-FileHash/);
});

test("restore drill uses isolated names, validates evidence, and cleans up", () => {
  assert.match(restore, /retail_restore_drill_/);
  assert.match(restore, /Restored row count mismatch/);
  assert.match(restore, /MinIO object\/version catalog count mismatch/);
  assert.match(restore, /dropdb/);
  assert.match(restore, /volume rm/);
  assert.match(restore, /rtoSeconds/);
});
