import assert from "node:assert/strict";
import test from "node:test";
import type { CdpCommandRecord } from "@retail-orchestrator/shared";
import { buildChromeLaunchArgs, buildIdentityHtml, resolveEndpointFromCommand, stopProfileChrome } from "../src/cdp-launcher.js";

function makeCommand(overrides: Partial<CdpCommandRecord> = {}): CdpCommandRecord {
  return {
    commandId: "cmd-1",
    workerId: "mm-worker",
    action: "launch_profile",
    status: "claimed",
    endpointId: "mm-worker:9256",
    port: 9256,
    profileId: "mm-profile-9256",
    profilePath: "browser-profiles/mm-profile-9256",
    accountDisplayName: "账号01",
    maskedLogin: "183****2030",
    operatorOwner: "运营甲",
    targetStoreName: "脱敏示例门店",
    proxyMode: "direct",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...overrides
  };
}

test("buildChromeLaunchArgs isolates profile and exposes CDP port", () => {
  const args = buildChromeLaunchArgs(makeCommand(), "F:/runtime/profiles/mm-profile-9256");

  assert.ok(args.includes("--remote-debugging-port=9256"));
  assert.ok(args.includes("--user-data-dir=F:/runtime/profiles/mm-profile-9256"));
  assert.ok(args.includes("--no-first-run"));
  assert.ok(args.includes("--no-default-browser-check"));
  assert.ok(args.includes("--no-proxy-server"));
});

test("resolveEndpointFromCommand returns durable endpoint snapshot", () => {
  assert.deepEqual(resolveEndpointFromCommand(makeCommand()), {
    endpointId: "mm-worker:9256",
    workerId: "mm-worker",
    host: "127.0.0.1",
    port: 9256,
    endpointUrl: "http://127.0.0.1:9256",
    status: "ready",
    profileId: "mm-profile-9256",
    accountDisplayName: "账号01",
    maskedLogin: "183****2030",
    operatorOwner: "运营甲",
    targetStoreName: "脱敏示例门店"
  });
});

test("identity page makes local phone, owner and store explicit and persistable", () => {
  const html = buildIdentityHtml(makeCommand());
  assert.match(html, /登录手机号（仅本机）/);
  assert.match(html, /账号所属人/);
  assert.match(html, /目标门店/);
  assert.match(html, /保存标识/);
  assert.match(html, /localStorage\.setItem/);
  assert.match(html, /Worker 心跳只向 Master 回传脱敏手机号/);
  assert.doesNotMatch(html, /password|Cookie:/i);
});

test("stopProfileChrome falls back to port cleanup when the launcher pid is stale", async () => {
  const stoppedPorts: number[] = [];

  await stopProfileChrome(10922, 4567, {
    kill: () => {
      throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    },
    stopByPort: async (port) => {
      stoppedPorts.push(port);
    }
  });

  assert.deepEqual(stoppedPorts, [10922]);
});
