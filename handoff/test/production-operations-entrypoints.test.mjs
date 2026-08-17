import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("registry scheduled-task entrypoints use the formal app snapshot", async () => {
  for (const file of ["deploy/windows/run-registry-sync.ps1", "deploy/windows/install-registry-sync-task.ps1"]) {
    const source = await read(file);
    assert.match(source, /D:\\SpanAI\\retail-radar-master\\app/);
    assert.doesNotMatch(source, /workspace\\retail-price-orchestrator/);
  }
});

test("master verification entrypoint loads private configuration without embedding credentials", async () => {
  const source = await read("deploy/windows/verify-master-handoff.ps1");
  assert.match(source, /production-deploy\.env/);
  assert.match(source, /worker-topology\.json/);
  assert.match(source, /MASTER_PUBLIC_BASE_URL/);
  assert.match(source, /production:self-check/);
  assert.match(source, /OutputEncoding/);
  assert.match(source, /Start-Process -FilePath 'ssh\.exe'/);
  assert.match(source, /WaitForExit\(\$TimeoutSeconds \* 1000\)/);
  assert.match(source, /Stop-Process -Id \$process\.Id -Force/);
  assert.match(source, /'cmd\.exe', '\/d', '\/s', '\/c', 'hostname'/);
  assert.match(source, /master_verification_non_scheduling_worker_bound/);
  assert.match(source, /master_verification_cdp_stale/);
  assert.match(source, /expected\.captureConcurrency/);
  assert.match(source, /\$ErrorActionPreference = 'Continue'/);
  assert.match(source, /\$exitCode = \$LASTEXITCODE/);
  assert.match(source, /verification-\$Name\.log/);
  assert.match(source, /\$output = @\(& \$Action 2>&1\)/);
  const consoleEncodingResets = [...source.matchAll(/\[Console\]::OutputEncoding/g)];
  assert.ok(consoleEncodingResets.length >= 2, "native child processes must not corrupt the final UTF-8 summary");
  assert.ok(
    consoleEncodingResets.at(-1).index > source.indexOf("registry_dry_run"),
    "the final UTF-8 reset must happen after every native verification step",
  );
  assert.match(source, /function ConvertTo-AsciiJson/);
  assert.match(source, /ConvertTo-AsciiJson \$summaryJson/);
  assert.match(source, /verification-summary-latest\.json/);
  assert.doesNotMatch(source, /(password|access_token)\s*=/i);
});

test("master verification turns empty SSH stdout into a bounded maintenance error", async () => {
  const source = await read("deploy/windows/verify-master-handoff.ps1");
  assert.match(source, /\$hostnameLine = @\(Get-Content/);
  assert.match(source, /if \(\$null -eq \$hostnameLine\) \{ '' \} else \{ \[string\]\$hostnameLine \}/);
  assert.match(source, /master_verification_worker_ssh_failed/);
});

test("CDP runtime refresh only opens identity pages and uses verified TLS", async () => {
  const source = await read("deploy/windows/refresh-worker-cdp-runtime.ps1");
  assert.match(source, /open_identity_page/);
  assert.match(source, /runtime_inventory_refresh_no_store_navigation/);
  assert.match(source, /--cacert/);
  assert.match(source, /storeNavigation = \$false/);
  assert.match(source, /active_tasks_block_profile_launch/);
  assert.match(source, /profile_launch_port_inventory_mismatch/);
  assert.match(source, /if \(\$LaunchProfiles\).*ExpectedPorts/s);
  assert.match(source, /h5\.waimai\.meituan\.com/);
  assert.match(source, /AbsolutePath -ne '\/login'/);
  assert.match(source, /\$payload\['launchUrl'\] = \$LoginUrl/);
  assert.doesNotMatch(source, /--insecure|-k\b/);
  assert.doesNotMatch(source, /(password|access_token)\s*=/i);
});

test("account assignment opens identity pages from a private map without starting collection", async () => {
  const source = await read("deploy/windows/assign-cdp-identity-pages.ps1");
  assert.match(source, /AssignmentPath/);
  assert.match(source, /production-deploy\.env/);
  assert.match(source, /open_identity_page/);
  assert.match(source, /identity_page_only_no_store_navigation/);
  assert.match(source, /account-pool/);
  assert.match(source, /status = 'reserved'/);
  assert.match(source, /--cacert/);
  assert.match(source, /active_cdp_commands_exist/);
  assert.match(source, /storeNavigation = \$false/);
  assert.doesNotMatch(source, /launch_profile|\/api\/tasks/);
  assert.doesNotMatch(source, /--insecure|-k\b/);
  assert.doesNotMatch(source, /(password|access_token)\s*=/i);
});
