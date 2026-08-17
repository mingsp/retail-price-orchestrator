import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CdpCommandRecord, CdpEndpointSnapshot } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "../src/config.js";
import { readCdpRuntimeInventory, recordCdpCommandResult } from "../src/cdp-runtime-state.js";

test("CDP helper persists a launch result for core heartbeats and task polling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "retail-radar-cdp-state-"));
  try {
    const config = {
      cdpStateFile: path.join(root, "cdp-runtime-state.json"),
      chromeProfileRoot: path.join(root, "profiles"),
      worker: { workerId: "worker-109" },
      accounts: [],
      cdpEndpoints: []
    } as unknown as WorkerConfig;
    const command = {
      commandId: "command-1",
      action: "launch_profile",
      status: "claimed",
      claimGeneration: 1,
      workerId: "worker-109",
      port: 10921,
      profileId: "worker-109-profile-01",
      profilePath: "worker-109-profile-01",
      accountId: "account-01",
      accountDisplayName: "账号一",
      maskedLogin: "138****0001",
      targetStoreId: "store-01",
      targetStoreName: "目标门店",
      proxyMode: "direct",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z"
    } as CdpCommandRecord;
    const endpoint: CdpEndpointSnapshot = {
      endpointId: "worker-109:10921",
      workerId: "worker-109",
      host: "127.0.0.1",
      port: 10921,
      endpointUrl: "http://127.0.0.1:10921",
      status: "ready",
      profileId: "worker-109-profile-01",
      accountId: "account-01",
      accountDisplayName: "账号一",
      maskedLogin: "138****0001",
      targetStoreId: "store-01",
      targetStoreName: "目标门店"
    };

    await recordCdpCommandResult(config, command, endpoint);

    const inventory = await readCdpRuntimeInventory(config);
    assert.equal(inventory.cdpEndpoints.length, 1);
    assert.equal(inventory.cdpEndpoints[0]?.status, "ready");
    assert.equal(inventory.accounts.length, 1);
    assert.equal(inventory.accounts[0]?.accountId, "account-01");
    assert.equal(inventory.accounts[0]?.profilePath, path.join(root, "profiles", "worker-109-profile-01"));
    assert.equal(inventory.accounts[0]?.cdpPort, 10921);

    const persisted = JSON.parse(await readFile(config.cdpStateFile, "utf8"));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.endpoints[0].maskedLogin, "138****0001");
    assert.equal(JSON.stringify(persisted).includes("workerToken"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a later stop result updates the same persisted slot instead of duplicating it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "retail-radar-cdp-stop-"));
  try {
    const config = {
      cdpStateFile: path.join(root, "cdp-runtime-state.json"),
      chromeProfileRoot: path.join(root, "profiles"),
      worker: { workerId: "worker-197" },
      accounts: [],
      cdpEndpoints: []
    } as unknown as WorkerConfig;
    const baseCommand = {
      commandId: "command-1",
      status: "claimed",
      claimGeneration: 1,
      workerId: "worker-197",
      port: 19721,
      profileId: "worker-197-profile-01",
      accountId: "account-01",
      accountDisplayName: "账号一",
      proxyMode: "direct",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z"
    } as CdpCommandRecord;
    const endpoint = {
      endpointId: "worker-197:19721",
      workerId: "worker-197",
      host: "127.0.0.1",
      port: 19721,
      endpointUrl: "http://127.0.0.1:19721",
      status: "ready",
      profileId: "worker-197-profile-01",
      accountId: "account-01"
    } as CdpEndpointSnapshot;

    await recordCdpCommandResult(config, { ...baseCommand, action: "launch_profile" }, endpoint);
    await recordCdpCommandResult(config, { ...baseCommand, commandId: "command-2", action: "stop_profile" }, { ...endpoint, status: "idle" });

    const inventory = await readCdpRuntimeInventory(config);
    assert.equal(inventory.cdpEndpoints.length, 1);
    assert.equal(inventory.cdpEndpoints[0]?.status, "idle");
    assert.equal(inventory.accounts.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
