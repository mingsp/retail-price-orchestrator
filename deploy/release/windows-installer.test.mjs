import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const installerUrl = new URL("../windows/install-worker.ps1", import.meta.url);
const workerLauncherUrl = new URL("../windows/start-worker.ps1", import.meta.url);
const cdpHelperLauncherUrl = new URL("../windows/start-cdp-helper.ps1", import.meta.url);
const workerUpgradeEntryUrl = new URL("../windows/invoke-worker-upgrade-from-stdin.ps1", import.meta.url);
const masterUpgradeEntryUrl = new URL("../windows/invoke-master-worker-upgrade.ps1", import.meta.url);
const runtimePreparationUrl = new URL("../windows/prepare-worker-runtime.ps1", import.meta.url);
const masterInstallEntryUrl = new URL("../windows/invoke-master-worker-install.ps1", import.meta.url);
const workerUpgradeUrl = new URL("../windows/upgrade-worker.ps1", import.meta.url);
const workerReleaseAccessUrl = new URL("../windows/test-worker-release-access.ps1", import.meta.url);
const workerResourcePolicyUrl = new URL("../windows/configure-worker-resource-policy.ps1", import.meta.url);
const standaloneLauncherUrl = new URL("../windows/start-standalone-node.ps1", import.meta.url);
const standaloneActivationUrl = new URL("../windows/activate-standalone-candidate.ps1", import.meta.url);
const masterBackupUrl = new URL("../windows/backup-master.ps1", import.meta.url);
const versionedSourcePreparationUrl = new URL("../windows/prepare-versioned-source.ps1", import.meta.url);
const windowsAclUrl = new URL("../windows/windows-acl.ps1", import.meta.url);
const observabilityConfigurationUrl = new URL("../windows/configure-observability.ps1", import.meta.url);

test("Windows installer registers the interactive CDP helper with the resolved Windows identity", async () => {
  const installer = await readFile(installerUrl, "utf8");

  assert.match(installer, /\$interactiveUser\s*=\s*\$currentIdentity\.Name/);
  assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn -User \$interactiveUser/);
  assert.match(installer, /New-ScheduledTaskPrincipal -UserId \$interactiveUser/);
  assert.doesNotMatch(installer, /New-ScheduledTask(?:Trigger|Principal).*\$env:USERDOMAIN/);
});

test("Windows CDP helper can start and keep running while a laptop is on battery", async () => {
  const [installer, upgrade] = await Promise.all([
    readFile(installerUrl, "utf8"),
    readFile(workerUpgradeUrl, "utf8")
  ]);

  assert.match(installer, /-AllowStartIfOnBatteries/);
  assert.match(installer, /-DontStopIfGoingOnBatteries/);
  assert.match(upgrade, /-AllowStartIfOnBatteries/);
  assert.match(upgrade, /-DontStopIfGoingOnBatteries/);
});

test("Windows launchers read the UTF-8 worker environment without corrupting Chinese labels", async () => {
  const launchers = await Promise.all([
    readFile(workerLauncherUrl, "utf8"),
    readFile(cdpHelperLauncherUrl, "utf8")
  ]);

  for (const launcher of launchers) {
    assert.match(launcher, /Get-Content\s+-LiteralPath\s+\$EnvironmentFile\s+-Encoding\s+UTF8/);
  }
});

test("Windows installer transports the machine label through an ASCII-safe base64 value", async () => {
  const installer = await readFile(installerUrl, "utf8");

  assert.match(installer, /\[string\]\$MachineLabelBase64/);
  assert.match(installer, /WORKER_MACHINE_LABEL_BASE64=/);
  assert.match(installer, /\[Convert\]::ToBase64String\(\[Text\.Encoding\]::UTF8\.GetBytes\(\$MachineLabel\)\)/);
});

test("Windows Worker upgrade entry consumes a protected automation token file", async () => {
  const entry = await readFile(workerUpgradeEntryUrl, "utf8");

  assert.match(entry, /AutomationTokenFile/);
  assert.match(entry, /\[IO\.File\]::WriteAllBytes/);
  assert.match(entry, /Remove-Item\s+-LiteralPath\s+\$resolvedTokenFile/);
  assert.match(entry, /if\s*\(\$existingEncodedLine\)/);
  assert.match(entry, /WORKER_MACHINE_LABEL_BASE64=/);
  assert.doesNotMatch(entry, /AUTOMATION_TOKEN\s*=/);
});

test("Master Worker upgrade entry transfers a short-lived token file without exposing its value", async () => {
  const entry = await readFile(masterUpgradeEntryUrl, "utf8");

  assert.match(entry, /AUTOMATION_TOKEN=/);
  assert.match(entry, /scp\.exe/);
  assert.match(entry, /WriteAllBytes/);
  assert.match(entry, /Remove-Item/);
  assert.match(entry, /powershell\.exe\s+-NoProfile\s+-ExecutionPolicy\s+Bypass\s+-File/);
  assert.doesNotMatch(entry, /access_token=/);
  assert.match(entry, /cmd\.exe\s+\/d\s+\/s\s+\/c\s+powershell\.exe/);
});

test("Windows upgrade restarts the interactive CDP helper after switch and rollback", async () => {
  const upgrade = await readFile(workerUpgradeUrl, "utf8");
  const restartCalls = upgrade.match(/Restart-CdpHelper/g) || [];

  assert.match(upgrade, /\$CdpHelperTaskName\s*=\s*"RetailRadarCdpHelper"/);
  assert.match(upgrade, /Stop-ScheduledTask/);
  assert.match(upgrade, /Start-ScheduledTask/);
  assert.ok(restartCalls.length >= 3, "expected a helper function plus success and rollback calls");
});

test("Master upgrade entry refreshes the Worker upgrade tooling before use", async () => {
  const entry = await readFile(masterUpgradeEntryUrl, "utf8");

  assert.match(entry, /invoke-worker-upgrade-from-stdin\.ps1/);
  assert.match(entry, /upgrade-worker\.ps1/);
  assert.match(entry, /bootstrap\/windows\/invoke-worker-upgrade-from-stdin\.ps1/);
  assert.match(entry, /Worker\/service\/upgrade-worker\.ps1/);
});

test("Windows runtime preparation verifies signed Node and Chrome installers", async () => {
  const source = await readFile(runtimePreparationUrl, "utf8");

  assert.match(source, /Get-AuthenticodeSignature/);
  assert.match(source, /SignatureStatus\]::Valid/);
  assert.match(source, /nodejs\.org\/download\/release/);
  assert.match(source, /dl\.google\.com\/dl\/chrome\/install/);
  assert.match(source, /Start-Process -FilePath 'msiexec\.exe'/);
  assert.doesNotMatch(source, /-k\b|--insecure/);
});

test("Master Worker install entry protects enrollment credentials", async () => {
  const source = await readFile(masterInstallEntryUrl, "utf8");

  assert.match(source, /OPERATOR_TOKEN=/);
  assert.match(source, /worker-enrollment-tokens/);
  assert.match(source, /EnrollmentTokenFile/);
  assert.match(source, /scp\.exe/);
  assert.match(source, /WriteAllBytes/);
  assert.match(source, /Remove-Item/);
  assert.doesNotMatch(source, /-EnrollmentToken\s+['"$]/);
});

test("Worker release access probe bounds nested SSH and avoids pipeline capture deadlocks", async () => {
  const source = await readFile(workerReleaseAccessUrl, "utf8");

  assert.match(source, /Start-Process\s+-FilePath\s+["']ssh\.exe["']/);
  assert.match(source, /RedirectStandardOutput/);
  assert.match(source, /RedirectStandardError/);
  assert.match(source, /WaitForExit\(\$SshTimeoutSeconds\s*\*\s*1000\)/);
  assert.match(source, /Stop-Process\s+-Id\s+\$process\.Id\s+-Force/);
  assert.match(source, /\$process\.Refresh\(\)/);
  assert.doesNotMatch(source, /@\(\s*&\s+ssh\.exe/);
  assert.doesNotMatch(source, /\$process\.ExitCode/);
  assert.match(source, /'cmd\.exe', '\/d', '\/s', '\/c'/);
});

test("Master Worker install entry uses the terminating Windows SSH shell wrapper", async () => {
  const source = await readFile(masterInstallEntryUrl, "utf8");
  assert.match(source, /cmd\.exe\s+\/d\s+\/s\s+\/c\s+powershell\.exe/);
});

test("Worker resource policy is bounded, backed up, and rolls back failed restarts", async () => {
  const source = await readFile(workerResourcePolicyUrl, "utf8");

  assert.match(source, /ValidateRange\(1, 32\).*CaptureConcurrency/);
  assert.match(source, /MemoryStopRatio -le \$MemoryShrinkRatio/);
  assert.match(source, /pre-resource-policy/);
  assert.match(source, /WORKER_CDP_STATE_FILE/);
  assert.match(source, /Copy-Item -LiteralPath \$backup -Destination \$EnvironmentFile -Force/);
  assert.match(source, /worker_runtime_restart_failed/);
  assert.doesNotMatch(source, /(password|access_token)\s*=/i);
});

test("Standalone startup uses the repository-pinned Node runtime", async () => {
  const source = await readFile(standaloneLauncherUrl, "utf8");

  assert.match(source, /\.node-version/);
  assert.match(source, /tools\\node-v\$requiredNodeVersion-win-x64/);
  assert.match(source, /\$corepackPath pnpm deploy:validate/);
  assert.match(source, /\$env:CI = 'true'/);
  assert.match(source, /--resolve \$localResolve "\$\{localMasterUrl\}\/ready"/);
  assert.match(source, /http:\/\/127\.0\.0\.1:9090\/\-\/ready/);
  assert.match(source, /--alertmanager\.url=http:\/\/127\.0\.0\.1:9093 alert query/);
  assert.match(source, /Observability services did not become healthy before timeout/);
  assert.doesNotMatch(source, /https:\/\/127\.0\.0\.1:2808\/ready/);
  assert.doesNotMatch(source, /& corepack pnpm/);
});

test("Standalone activation switches startup only after health and version verification", async () => {
  const source = await readFile(standaloneActivationUrl, "utf8");
  const versionCheckIndex = source.indexOf("Get-VersionDocument");
  const taskSwitchIndex = source.indexOf("Set-ScheduledTask");
  const observabilityInvocation = source.match(/& powershell\.exe[^\r\n]*\$observabilityScript `\r?\n\s*[^\r\n]+/)?.[0] ?? "";

  assert.match(source, /candidate-verification\.json/);
  assert.match(source, /standalone\.env\.production/);
  assert.match(source, /Activated API identity mismatch/);
  assert.match(source, /Get-VersionDocument -MasterHostname \$masterHostname/);
  assert.match(source, /--resolve "\$\{MasterHostname\}:2808:127\.0\.0\.1"/);
  assert.doesNotMatch(source, /https:\/\/127\.0\.0\.1:2808\/api\/version/);
  assert.match(observabilityInvocation, /-ProductionEnvPath \$environmentPath -OutputConfigPath \$alertmanagerConfigPath/);
  assert.match(source, /-TemplatePath \$alertmanagerTemplatePath/);
  assert.doesNotMatch(observabilityInvocation, /-ProjectRoot|-StateRoot/);
  assert.match(source, /Copy-Item -LiteralPath \$environmentBackup -Destination \$environmentPath -Force/);
  assert.match(source, /Start-ScheduledTask -TaskName \$StartupTaskName/);
  assert.match(source, /Add-Member -NotePropertyName activatedAt/);
  assert.ok(versionCheckIndex >= 0 && taskSwitchIndex > versionCheckIndex);
  assert.doesNotMatch(source, /(password|access_token)\s*=/i);
});

test("Master backup includes the protected standalone environment", async () => {
  const source = await readFile(masterBackupUrl, "utf8");
  assert.match(source, /config\\\.env\.production/);
  assert.match(source, /standalone\.env\.production/);
});

test("Versioned source preparation judges native commands by exit code under redirected logging", async () => {
  const source = await readFile(versionedSourcePreparationUrl, "utf8");

  assert.match(source, /function Invoke-NativeCommand/);
  assert.match(source, /\$ErrorActionPreference = 'Continue'/);
  assert.match(source, /\$exitCode = \$LASTEXITCODE/);
  assert.match(source, /Invoke-NativeCommand -Command \$gitCommand/);
  assert.match(source, /Invoke-NativeCommand -Command \$script:corepackCommand/);
  assert.match(source, /OfflineCorepackHome/);
  assert.match(source, /OfflinePnpmStore/);
  assert.match(source, /OfflinePnpmCache/);
  assert.match(source, /COREPACK_ENABLE_NETWORK = '0'/);
  assert.match(source, /--offline', '--store-dir'/);
  assert.match(source, /--config\.cache-dir=/);
  assert.match(source, /offlineDependencyCache = \$offlineRequested/);
  assert.doesNotMatch(source, /& \$gitCommand clone/);
});

test("SYSTEM-run production scripts protect files by SID instead of the machine-account username", async () => {
  const [acl, activation, backup, observability] = await Promise.all([
    readFile(windowsAclUrl, "utf8"),
    readFile(standaloneActivationUrl, "utf8"),
    readFile(masterBackupUrl, "utf8"),
    readFile(observabilityConfigurationUrl, "utf8")
  ]);

  assert.match(acl, /\*S-1-5-18/);
  assert.match(acl, /\*S-1-5-32-544/);
  assert.match(acl, /WindowsIdentity\]::GetCurrent/);
  assert.doesNotMatch(acl, /env:USERNAME/);
  for (const source of [activation, backup, observability]) {
    assert.match(source, /windows-acl\.ps1/);
    assert.match(source, /Protect-RetailRadarPath/);
    assert.doesNotMatch(source, /env:USERNAME/);
  }
  assert.match(observability, /com\.docker\.backend/);
  assert.match(observability, /SecurityIdentifier/);
  assert.match(observability, /\*\$sid`:\(R\)/);
});
