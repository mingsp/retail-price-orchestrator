import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backup = await readFile(new URL("../windows/backup-master.ps1", import.meta.url), "utf8");
const restore = await readFile(new URL("../windows/restore-drill.ps1", import.meta.url), "utf8");
const scheduled = await readFile(new URL("../windows/invoke-scheduled-backup.ps1", import.meta.url), "utf8");
const installer = await readFile(new URL("../windows/install-backup-schedule.ps1", import.meta.url), "utf8");
const peerHealth = await readFile(new URL("../windows/invoke-peer-health-monitor.ps1", import.meta.url), "utf8");

test("backup captures PostgreSQL and a consistent versioned MinIO volume", () => {
  assert.match(backup, /pg_dump/);
  assert.match(backup, /docker\.exe pause \$minioContainer/);
  assert.match(backup, /minio-data\.tar/);
  assert.match(backup, /criticalTableCounts/);
  assert.match(backup, /Get-FileHash/);
});

test("scheduled backup requires external policy, verifies the off-host copy, and fences retention", () => {
  assert.match(scheduled, /PolicyPath/);
  assert.match(scheduled, /Copy-BackupVerified/);
  assert.match(scheduled, /Off-host backup checksum mismatch/);
  assert.match(scheduled, /Test-ChildPath/);
  assert.match(scheduled, /MinimumCopies/);
  assert.match(scheduled, /RunRestoreDrill/);
  assert.match(scheduled, /Docker\\Docker\\resources\\bin/);
  assert.match(scheduled, /docker_cli_missing/);
});

test("backup schedule installs separate daily backup and weekly restore tasks", () => {
  assert.match(installer, /RetailRadar-Master-DailyBackup/);
  assert.match(installer, /RetailRadar-Master-WeeklyRestoreDrill/);
  assert.match(installer, /-RunRestoreDrill/);
  assert.match(installer, /-MultipleInstances IgnoreNew/);
  assert.match(installer, /RunnerPath/);
});

test("peer health fallback reads protected configuration and sends only state transitions", () => {
  assert.match(peerHealth, /DINGTALK_WEBHOOK_URL/);
  assert.match(peerHealth, /failureThreshold/);
  assert.match(peerHealth, /previousStatus -ne 'unavailable'/);
  assert.match(peerHealth, /previousStatus -eq 'unavailable'/);
  assert.match(peerHealth, /outcome_unknown/);
  assert.doesNotMatch(peerHealth, /access_token=/);
});

test("restore drill uses isolated names, validates evidence, and cleans up", () => {
  assert.match(restore, /retail_restore_drill_/);
  assert.match(restore, /Restored row count mismatch/);
  assert.match(restore, /MinIO object\/version catalog count mismatch/);
  assert.match(restore, /dropdb/);
  assert.match(restore, /volume rm/);
  assert.match(restore, /rtoSeconds/);
});
