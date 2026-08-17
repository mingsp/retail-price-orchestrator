import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCdpCommandEndpointId,
  canClaimCdpCommand,
  completeCdpCommand,
  isCdpCommandClaimable,
  normalizeCdpCommandInput,
  validateCdpCommandSlot
} from "../src/repositories/cdp-commands.js";

test("normalizeCdpCommandInput creates deterministic endpoint id and profile path", () => {
  const input = normalizeCdpCommandInput({
    workerId: "mm-worker",
    action: "launch_profile",
    port: 9256,
    profileId: "mm-profile-9256",
    operatorOwner: "运营甲",
    targetStoreName: "呱呱超市（南门店）"
  });

  assert.equal(input.endpointId, "mm-worker:9256");
  assert.equal(input.profilePath, "browser-profiles/mm-profile-9256");
  assert.equal(input.proxyMode, "system");
});

test("normalizeCdpCommandInput uses the stable slot identity when supplied", () => {
  const input = normalizeCdpCommandInput({
    slotId: "slot-01",
    workerId: "mm-worker",
    action: "launch_profile",
    port: 9256,
    profileId: "mm-profile-9256"
  });

  assert.equal(input.endpointId, "slot:slot-01");
});

test("buildCdpCommandEndpointId is stable by worker and port", () => {
  assert.equal(buildCdpCommandEndpointId("jl-worker", 19224), "jl-worker:19224");
});

test("canClaimCdpCommand only allows the target worker to claim pending commands", () => {
  assert.equal(canClaimCdpCommand({ status: "pending", workerId: "mm-worker" }, "mm-worker"), true);
  assert.equal(canClaimCdpCommand({ status: "claimed", workerId: "mm-worker" }, "mm-worker"), false);
  assert.equal(canClaimCdpCommand({ status: "pending", workerId: "mm-worker" }, "jl-worker"), false);
});

test("an expired CDP command lease can be reclaimed but an active lease cannot", () => {
  const now = new Date("2026-07-15T06:00:00.000Z");
  assert.equal(isCdpCommandClaimable({ status: "pending" }, now), true);
  assert.equal(isCdpCommandClaimable({ status: "claimed", claimUntil: "2026-07-15T05:59:59.000Z" }, now), true);
  assert.equal(isCdpCommandClaimable({ status: "claimed", claimUntil: "2026-07-15T06:00:01.000Z" }, now), false);
  assert.equal(isCdpCommandClaimable({ status: "completed" }, now), false);
});

test("a CDP command must match its stable slot ownership and bindings", () => {
  const slot = {
    workerId: "mm-worker",
    port: 9256,
    status: "idle",
    profileId: "profile-a",
    accountId: "account-a",
    targetStoreId: "store-a"
  };
  const command = {
    slotId: "slot-01",
    workerId: "mm-worker",
    action: "launch_profile" as const,
    port: 9256,
    profileId: "profile-a",
    accountId: "account-a",
    targetStoreId: "store-a"
  };

  assert.doesNotThrow(() => validateCdpCommandSlot(command, slot));
  assert.throws(() => validateCdpCommandSlot({ ...command, workerId: "jl-worker" }, slot), /slot_worker_mismatch/);
  assert.throws(() => validateCdpCommandSlot({ ...command, profileId: "profile-b" }, slot), /slot_profile_mismatch/);
  assert.throws(() => validateCdpCommandSlot({ ...command, targetStoreId: "store-b" }, slot), /slot_store_mismatch/);
});

test("CDP command completion rolls back when endpoint registration fails", async () => {
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      if (sql.includes("UPDATE cdp_commands")) {
        return { rows: [{
          command_id: "command-1", worker_id: "worker-a", action: "launch_profile",
          status: "completed", port: 9256, profile_id: "profile-a", proxy_mode: "system",
          claim_generation: 2, created_at: new Date(), updated_at: new Date()
        }] };
      }
      if (sql.includes("INSERT INTO cdp_endpoints")) throw new Error("endpoint_write_failed");
      return { rows: [] };
    },
    release: () => undefined
  };
  const db = { connect: async () => client } as any;

  await assert.rejects(completeCdpCommand(db, "command-1", {
    status: "completed",
    claimGeneration: 2,
    endpoint: { workerId: "worker-a", port: 9256, status: "ready" }
  }, "worker-a"), /endpoint_write_failed/);
  assert.ok(statements.includes("ROLLBACK"));
  assert.equal(statements.includes("COMMIT"), false);
});
