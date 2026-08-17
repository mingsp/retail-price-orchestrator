import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "../..");
const failures = [];

async function text(path) {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch (error) {
    failures.push(`${path}: file is missing (${error.code ?? error.message})`);
    return "";
  }
}

function expect(path, content, pattern, message) {
  if (!pattern.test(content)) failures.push(`${path}: ${message}`);
}

function reject(path, content, pattern, message) {
  if (pattern.test(content)) failures.push(`${path}: ${message}`);
}

function expectOrderedPhases(path, content) {
  const phases = ["DRAIN", "DOWNLOAD", "SHA256", "SWITCH", "RESTART", "HEALTH", "ROLLBACK"];
  let previousIndex = -1;
  for (const phase of phases) {
    const marker = `DEPLOY_PHASE: ${phase}`;
    const index = content.indexOf(marker);
    if (index < 0) {
      failures.push(`${path}: missing ordered phase marker ${marker}`);
      continue;
    }
    if (index <= previousIndex) failures.push(`${path}: phase ${phase} is out of order`);
    previousIndex = index;
  }
}

function expectSwitchProtected(path, content, shell) {
  const switchIndex = content.indexOf("DEPLOY_PHASE: SWITCH");
  if (switchIndex < 0) return;
  if (shell === "powershell") {
    const tryIndex = content.lastIndexOf("try {", switchIndex);
    const catchIndex = content.indexOf("} catch {", switchIndex);
    if (tryIndex < 0 || catchIndex < 0 || tryIndex > switchIndex || catchIndex < switchIndex) {
      failures.push(`${path}: SWITCH must be inside a PowerShell try/catch rollback boundary`);
    }
    return;
  }
  const transactionIndex = content.lastIndexOf("upgrade_transaction()", switchIndex);
  const guardedCallIndex = content.indexOf("if ! upgrade_transaction; then", switchIndex);
  const rollbackIndex = content.indexOf("rollback_release", guardedCallIndex);
  if (transactionIndex < 0 || guardedCallIndex < 0 || rollbackIndex < guardedCallIndex) {
    failures.push(`${path}: SWITCH must be inside upgrade_transaction with an explicit rollback failure branch`);
  }
}

function serviceBlock(compose, serviceName) {
  const escaped = serviceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = compose.match(new RegExp(`^  ${escaped}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\r?$|^volumes:\\r?$|^networks:\\r?$|\\Z)`, "m"));
  return match?.[1] ?? "";
}

const paths = {
  dockerignore: ".dockerignore",
  gitignore: ".gitignore",
  compose: "infra/docker-compose.production.yml",
  caddy: "infra/caddy/Caddyfile",
  masterDockerfile: "deploy/docker/master.Dockerfile",
  dashboardDockerfile: "deploy/docker/dashboard.Dockerfile",
  windowsInstaller: "deploy/windows/install-worker.ps1",
  windowsService: "deploy/windows/retail-worker-service.xml",
  windowsUpgrade: "deploy/windows/upgrade-worker.ps1",
  macInstaller: "deploy/macos/install-worker.sh",
  macService: "deploy/macos/com.retailradar.worker.plist",
  macUpgrade: "deploy/macos/upgrade-worker.sh",
  manifestBuilder: "deploy/release/build-release-manifest.mjs",
  manifestExample: "deploy/release/release-manifest.example.json",
  masterDoc: "docs/master-deployment.md",
  workerDoc: "docs/worker-onboarding.md",
  upgradeDoc: "docs/upgrade-rollback.md",
  rootPackage: "package.json",
  masterPackage: "apps/master/package.json",
  workerPackage: "apps/worker/package.json"
  ,workerConfig: "apps/worker/src/config.ts"
  ,workerIdentityStore: "apps/worker/src/worker-identity-store.ts"
  ,workerEnrollmentClient: "apps/worker/src/enrollment-client.ts"
  ,taskWriteGuard: "apps/master/src/repositories/task-write-guard.ts"
  ,rawDataSync: "apps/master/src/repositories/raw-data-sync.ts"
  ,s3: "apps/master/src/s3.ts"
  ,sharedMessages: "packages/shared/src/messages.ts"
  ,artifactRoutes: "apps/master/src/routes/artifacts.ts"
  ,workerMasterApi: "apps/worker/src/master-api.ts"
  ,workerProcessLifecycle: "apps/worker/src/child-process-lifecycle.ts"
  ,legacyCollector: "apps/worker/src/legacy-collector.ts"
  ,nativeCollector: "apps/worker/src/native-collector.ts"
};

const entries = Object.fromEntries(
  await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await text(path)]))
);

const compose = entries.compose;
for (const service of ["caddy", "dashboard", "master", "postgres", "redis", "minio"]) {
  expect(paths.compose, compose, new RegExp(`^  ${service}:`, "m"), `service ${service} is required`);
}

for (const service of ["dashboard", "master", "postgres", "redis", "minio"]) {
  reject(paths.compose, serviceBlock(compose, service), /^    ports:/m, `${service} must not publish host ports`);
}
expect(paths.compose, serviceBlock(compose, "caddy"), /(?:^|\n)    ports:\r?\n\s+-\s+"?2808:2808"?/m, "Caddy must be the only required service publishing port 2808");
reject(paths.compose, compose, /(?:change-me|retail-password|POSTGRES_PASSWORD:\s*retail\s*$|MINIO_ROOT_PASSWORD:\s*retail)/mi, "production defaults must not contain known development secrets");
reject(paths.compose, compose, /RUSTDESK_SERVER_IMAGE:\?/, "base Compose config must not require the optional RustDesk image when its profile is disabled");

for (const variable of [
  "POSTGRES_PASSWORD",
  "REDIS_PASSWORD",
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
  "AUTOMATION_TOKEN",
  "OPERATOR_TOKEN"
]) {
  expect(paths.compose, compose, new RegExp(`\\$\\{${variable}:\\?[^}]+\\}`), `${variable} must use a mandatory \${VAR:?message} expression`);
}

expect(paths.caddy, entries.caddy, /handle\s+\/api\/\*/, "Caddy must route /api/*");
expect(paths.caddy, entries.caddy, /handle\s+\/ws\/\*/, "Caddy must route /ws/*");
for (const bucket of ["raw-artifacts", "exports", "screenshots", "logs"]) {
  expect(paths.caddy, entries.caddy, new RegExp(`handle\\s+/${bucket.replace("-", "\\-")}\\/\\*`), `Caddy must route signed ${bucket} object paths`);
}
expect(paths.caddy, entries.caddy, /reverse_proxy\s+master:17890/, "Caddy must proxy API and WebSocket traffic to Master");
expect(paths.caddy, entries.caddy, /reverse_proxy\s+minio:9000/, "Caddy must proxy signed object paths to MinIO");
expect(paths.caddy, entries.caddy, /reverse_proxy\s+dashboard:80/, "Caddy must proxy the dashboard fallback");
expect(paths.compose, serviceBlock(compose, "caddy"), /OPERATOR_TOKEN:\s*\$\{OPERATOR_TOKEN:/, "Caddy must receive the internal operator token from production configuration");
const operatorHeaderCount = entries.caddy.match(/header_up\s+X-Retail-Operator-Token\s+\{\$OPERATOR_TOKEN\}/g)?.length || 0;
if (operatorHeaderCount !== 2) {
  failures.push(`${paths.caddy}: Caddy must inject the internal operator token only for API and WebSocket proxy routes (found ${operatorHeaderCount})`);
}
reject(paths.caddy, entries.caddy, /header_up\s+Authorization/i, "Caddy must not overwrite Worker Authorization Bearer credentials");
expect(paths.compose, serviceBlock(compose, "master"), /S3_PUBLIC_ENDPOINT:\s*\$\{MASTER_PUBLIC_BASE_URL:/, "Master must sign Worker-accessible object URLs with the public endpoint");

for (const pattern of [/\.runtime\//i, /Cookies/i, /Login Data/i, /token/i]) {
  expect(paths.dockerignore, entries.dockerignore, pattern, `root .dockerignore must exclude ${pattern}`);
}
expect(paths.gitignore, entries.gitignore, /(?:^|\n)\.runtime\/\r?$/m, "Git must ignore local runtime state and Chrome profiles");

for (const [key, label] of [["masterDockerfile", "Master"], ["dashboardDockerfile", "Dashboard"]]) {
  expect(paths[key], entries[key], /FROM\s+[^\s]+/i, `${label} image must declare a base image`);
  reject(paths[key], entries[key], /(?:latest|curl\s+[^\n]*\|\s*(?:sh|bash))/i, `${label} image must avoid floating latest tags and pipe-to-shell installs`);
}
expect(paths.masterDockerfile, entries.masterDockerfile, /packages\/shared\/dist/, "Master runtime image must copy the compiled shared package");
expect(paths.masterDockerfile, entries.masterDockerfile, /@retail-orchestrator\/shared[^\n]*(?:build|exec\s+tsc)/i, "Master image must compile @retail-orchestrator/shared");
expect(paths.masterDockerfile, entries.masterDockerfile, /packages\/shared\/package\.json/, "Master runtime image must include a runnable shared package manifest");

for (const marker of ["node", "chrome", "Test-Path", "Invoke-WebRequest", "winsw", "restart", "retail-worker-service.xml"]) {
  expect(paths.windowsInstaller, entries.windowsInstaller, new RegExp(marker, "i"), `Windows installer must include ${marker}`);
}
expect(
  paths.windowsInstaller,
  entries.windowsInstaller,
  /if\s*\(-not\s+\$HeartbeatOnly\)[\s\S]*start-cdp-helper\.ps1[\s\S]*Register-ScheduledTask/i,
  "Windows installer must register an interactive-user CDP helper only outside heartbeat-only mode"
);
expect(
  paths.windowsInstaller,
  entries.windowsInstaller,
  /if\s*\(\$HeartbeatOnly\)[\s\S]*WORKER_ACCOUNTS_JSON=\[\][\s\S]*WORKER_CDP_ENDPOINTS_JSON=\[\]/i,
  "Windows heartbeat-only installation must publish no account or CDP resources"
);
expect(
  paths.windowsInstaller,
  entries.windowsInstaller,
  /\.installing[\s\S]*try\s*\{[\s\S]*catch\s*\{[\s\S]*(?:Remove-Item|Remove-ManagedLink)/i,
  "Windows installer must use an installation journal and clean partial state after failure"
);
for (const marker of ["OnFailure", "ResetFailure", "StartMode", "SERVICE_START_PENDING"]) {
  expect(paths.windowsService, entries.windowsService, new RegExp(marker, "i"), `WinSW configuration must include ${marker}`);
}
for (const marker of ["node", "Google Chrome", "curl", "launchctl", "KeepAlive", "RunAtLoad", "retailradar"]) {
  expect(paths.macInstaller, `${entries.macInstaller}\n${entries.macService}`, new RegExp(marker, "i"), `macOS deployment must include ${marker}`);
}
expect(paths.macInstaller, entries.macInstaller, /state\s*=\s*running/i, "macOS installer must parse launchctl state=running");
expect(paths.macInstaller, entries.macInstaller, /pid\s*=\s*\[?1-9/i, "macOS installer must validate a positive launchd PID");

for (const [key, path] of [["windowsUpgrade", paths.windowsUpgrade], ["macUpgrade", paths.macUpgrade]]) {
  const content = entries[key];
  for (const marker of ["drain", "sha256", "releases", "current", "health", "rollback"]) {
    expect(path, content, new RegExp(marker, "i"), `upgrade flow must include ${marker}`);
  }
  reject(path, content, /Copy-Item[^\n]+-Force[^\n]+current|cp\s+-f\s+[^\n]+current/i, "upgrade must not silently overwrite the active release");
  expectOrderedPhases(path, content);
  expect(path, content, /resume/i, "upgrade must resume the tasks recorded during drain");
  expect(path, content, /StableHealth|STABLE_HEALTH/i, "upgrade health must require a stable online window");
  expect(path, content, /agentVersion|agent_version/i, "upgrade health must verify the running Worker version");
  expect(path, content, /release.public.key|RELEASE_PUBLIC_KEY/i, "upgrade must pin a release signing public key");
}
expect(paths.windowsUpgrade, entries.windowsUpgrade, /function\s+Stop-WorkerServiceForUpgrade[\s\S]*taskkill\.exe/i, "Windows upgrades must bound service stop and provide a force-stop fallback");
expect(paths.windowsUpgrade, entries.windowsUpgrade, /Assert-HeartbeatOnlyConfiguration[\s\S]*WORKER_ENABLE_TASK_POLLING=false[\s\S]*WORKER_ACCOUNTS_JSON=\[\]/i, "Windows heartbeat-only upgrades must verify execution and resource isolation");
expectSwitchProtected(paths.windowsUpgrade, entries.windowsUpgrade, "powershell");
expectSwitchProtected(paths.macUpgrade, entries.macUpgrade, "shell");

expect(paths.manifestBuilder, entries.manifestBuilder, /sha256/i, "manifest builder must calculate SHA256");
expect(paths.manifestBuilder, entries.manifestBuilder, /createSignedReleaseManifest|Ed25519/i, "manifest builder must sign releases with Ed25519");
expect(paths.manifestBuilder, entries.manifestBuilder, /assertHttpsUrl/i, "manifest builder must reject non-HTTPS artifact URLs");
let manifest;
try {
  manifest = JSON.parse(entries.manifestExample);
} catch (error) {
  failures.push(`${paths.manifestExample}: invalid JSON (${error.message})`);
}
if (manifest) {
  for (const field of ["schemaVersion", "keyId", "payload", "signature"]) {
    if (!manifest[field]) failures.push(`${paths.manifestExample}: field ${field} is required`);
  }
  if (manifest.schemaVersion !== 2 || manifest.signature?.algorithm !== "Ed25519") {
    failures.push(`${paths.manifestExample}: signed manifest schema v2 with Ed25519 is required`);
  }
  if (!Array.isArray(manifest.payload?.artifacts) || manifest.payload.artifacts.length < 2) {
    failures.push(`${paths.manifestExample}: artifacts must cover Windows and macOS`);
  } else {
    for (const artifact of manifest.payload.artifacts) {
      for (const field of ["platform", "url", "sha256"]) {
        if (!artifact[field]) failures.push(`${paths.manifestExample}: artifact field ${field} is required`);
      }
      if (!String(artifact.url).startsWith("https://")) failures.push(`${paths.manifestExample}: artifact URL must use HTTPS`);
    }
  }
}

expect(paths.windowsInstaller, entries.windowsInstaller, /\$\{env:USERNAME\}.*F/, "Windows ACL must use braced USERNAME expansion");
expect(paths.windowsInstaller, entries.windowsInstaller, /identityFile[\s\S]*Set-SecureFileAcl/i, "Windows installer must protect the identity file ACL");
reject(paths.windowsInstaller, entries.windowsInstaller, /\[string\]\$WorkerId|WORKER_ID=/i, "Windows installer must use the Master-issued Worker ID, not an operator-supplied ID");
expect(paths.windowsInstaller, entries.windowsInstaller, /ConvertFrom-Json[\s\S]*workerId/i, "Windows installer must read the Master-issued Worker ID from the persisted identity");
expect(paths.windowsInstaller, entries.windowsInstaller, /\.installing[\s\S]*Get-Service[\s\S]*Remove-WorkerServiceForCleanup/i, "Windows interrupted-install recovery must remove a partially installed service");
expect(paths.windowsInstaller, entries.windowsInstaller, /function\s+Remove-WorkerServiceForCleanup[\s\S]*taskkill\.exe[\s\S]*sc\.exe\s+delete/i, "Windows service cleanup must have a bounded force-stop and SCM removal fallback");
reject(paths.windowsInstaller, entries.windowsInstaller, /Remove-Item[^\n]*(?:identityFile|worker-identity)|Remove-Item[\s\S]{0,80}\$identityFile/i, "Windows install rollback must preserve an issued Worker credential");
reject(paths.macInstaller, entries.macInstaller, /--worker-id|printf\s+['"]WORKER_ID=|^\s*WORKER_ID=/im, "macOS installer must use the Master-issued Worker ID, not an operator-supplied ID");
expect(paths.macInstaller, entries.macInstaller, /IDENTITY_FILE[\s\S]*(?:JSON\.parse|workerId)/i, "macOS installer must read the Master-issued Worker ID from the persisted identity");
expect(paths.macInstaller, entries.macInstaller, /INSTALL_MARKER[\s\S]*launchctl bootout/i, "macOS interrupted-install recovery must unload a partially installed service");
reject(paths.macInstaller, entries.macInstaller, /rm\s+(?:-[a-zA-Z]*f[a-zA-Z]*\s+)?["']?\$?\{?IDENTITY_FILE/i, "macOS install rollback must preserve an issued Worker credential");
reject(paths.windowsUpgrade, entries.windowsUpgrade, /^\s*\[Parameter[^\n]*\]\s*\[string\]\$WorkerId\b/im, "Windows upgrades must derive Worker ID from the persisted identity");
expect(paths.windowsUpgrade, entries.windowsUpgrade, /worker-identity\.json[\s\S]*ConvertFrom-Json[\s\S]*workerId[\s\S]*workerToken/i, "Windows upgrades must load Worker ID and token from the persisted identity");
expect(paths.windowsUpgrade, entries.windowsUpgrade, /api\/worker\/self/i, "Windows upgrades must use the Worker self health endpoint");
expect(paths.windowsUpgrade, entries.windowsUpgrade, /Bearer\s+\$WorkerToken/i, "Windows upgrades must authenticate health checks with the individual Worker token");
expect(paths.windowsUpgrade, entries.windowsUpgrade, /api\/automation\/v1\/workers\/\$WorkerId\/active-tasks/i, "Windows upgrades must use the automation-scoped active task endpoint");
reject(paths.macUpgrade, entries.macUpgrade, /--worker-id/i, "macOS upgrades must derive Worker ID from the persisted identity");
expect(paths.macUpgrade, entries.macUpgrade, /worker-identity\.json[\s\S]*(?:JSON\.parse|workerId)[\s\S]*workerToken/i, "macOS upgrades must load Worker ID and token from the persisted identity");
expect(paths.macUpgrade, entries.macUpgrade, /api\/worker\/self/i, "macOS upgrades must use the Worker self health endpoint");
expect(paths.macUpgrade, entries.macUpgrade, /Bearer\s+\$WORKER_TOKEN/i, "macOS upgrades must authenticate health checks with the individual Worker token");
expect(paths.macUpgrade, entries.macUpgrade, /api\/automation\/v1\/workers\/\$WORKER_ID\/active-tasks/i, "macOS upgrades must use the automation-scoped active task endpoint");
expect(paths.workerEnrollmentClient, entries.workerEnrollmentClient, /persisted[\s\S]*resolveWorkerIdentity/i, "Worker enrollment retry must prefer a persisted independent identity");
expect(
  paths.workerIdentityStore,
  entries.workerIdentityStore,
  /\/inheritance:r[\s\S]*icacls\.exe/i,
  "Worker identity persistence must remove inherited Windows ACLs before writing credentials"
);
reject(paths.workerConfig, entries.workerConfig, /agentVersion:\s*["']0\.1\.0["']/, "Worker agentVersion must not be hard-coded");
expect(paths.workerConfig, entries.workerConfig, /WORKER_AGENT_VERSION[\s\S]*package\.json/i, "Worker agentVersion must come from environment or package version");

expect(paths.taskWriteGuard, entries.taskWriteGuard, /artifact_object_key_out_of_scope/, "Worker artifact writes must be restricted to the authoritative task prefix");
expect(paths.taskWriteGuard, entries.taskWriteGuard, /artifact_identity_mismatch/, "Worker artifact registration must verify authoritative run, store, account, and profile identity");
expect(paths.taskWriteGuard, entries.taskWriteGuard, /\["raw-artifacts",\s*"screenshots",\s*"logs"\]/, "Worker artifact writes must use the explicit non-export bucket allowlist");
reject(paths.taskWriteGuard, entries.taskWriteGuard, /\["raw-artifacts",\s*"exports"/, "Workers must not be allowed to write business exports");
expect(paths.rawDataSync, entries.rawDataSync, /storage_version_id/, "Raw-data synchronization must load the frozen object version ID");
expect(paths.rawDataSync, entries.rawDataSync, /requiredRawArtifactReadOptions[\s\S]*versionId/, "Raw-data synchronization must require exact-version object reads");
expect(paths.s3, entries.s3, /setBucketVersioning\([^\n]*Status:\s*"Enabled"/, "All managed object buckets must enable versioning");
expect(paths.sharedMessages, entries.sharedMessages, /interface PresignArtifactInput[\s\S]*accountId:\s*string;[\s\S]*profileId:\s*string;/, "Artifact presign requests must carry account and Profile identity");
reject(paths.artifactRoutes, entries.artifactRoutes, /assertActiveTaskArtifactWriteScope\([^;]*,\s*false\s*\)/, "Artifact presign must never bypass full identity validation");
expect(paths.workerMasterApi, entries.workerMasterApi, /artifacts\/presign[\s\S]*accountId:\s*account\.accountId[\s\S]*profileId:\s*account\.profileId/, "Worker presign requests must submit the assigned account and Profile identity");
expect(paths.workerProcessLifecycle, entries.workerProcessLifecycle, /taskkill\.exe[\s\S]*"\/T"[\s\S]*"\/F"/, "Windows collector shutdown must terminate the complete process tree");
expect(paths.workerProcessLifecycle, entries.workerProcessLifecycle, /process\.kill\(-pid,\s*signal\)/, "macOS/Linux collector shutdown must target the collector process group");
for (const [key, label] of [["legacyCollector", "Legacy"], ["nativeCollector", "Native"]]) {
  expect(paths[key], entries[key], /collectorProcessGroupOptions/, `${label} collector must start in a managed process group`);
  expect(paths[key], entries[key], /terminateChildProcessTree/, `${label} collector must terminate its process tree when the lease is lost`);
  expect(paths[key], entries[key], /waitForChildClose/, `${label} collector must attach close observation before an abort can race`);
}

for (const [key, path] of [["macInstaller", paths.macInstaller], ["macUpgrade", paths.macUpgrade]]) {
  for (const line of entries[key].split(/\r?\n/).filter((line) => /\bcurl\s+--/.test(line))) {
    if (!line.includes("CURL_CA_ARGS")) failures.push(`${path}: every curl request must include CURL_CA_ARGS (${line.trim()})`);
  }
}

expect(paths.masterPackage, entries.masterPackage, /"build"\s*:\s*"tsc"/, "Master package must have a TypeScript build script");
expect(paths.workerPackage, entries.workerPackage, /"build"\s*:\s*"tsc"/, "Worker package must have a TypeScript build script");
expect(paths.rootPackage, entries.rootPackage, /"build:production"/, "root package must expose production build validation");
expect(paths.rootPackage, entries.rootPackage, /"deploy:validate"/, "root package must expose static deployment validation");

for (const [key, title] of [["masterDoc", "Master"], ["workerDoc", "Worker"], ["upgradeDoc", "upgrade"]]) {
  expect(paths[key], entries[key], /##\s+/, `${title} documentation must contain operational sections`);
}
reject(paths.workerDoc, entries.workerDoc, /(?:-WorkerId|--worker-id)\b/i, "Worker onboarding must not ask operators to choose a Worker ID");
reject(paths.upgradeDoc, entries.upgradeDoc, /(?:-WorkerId|--worker-id)\b/i, "Worker upgrades must not accept an operator-supplied Worker ID");
expect(paths.workerDoc, entries.workerDoc, /Master[\s\S]*(?:唯一|权威)[\s\S]*(?:worker_id|Worker ID)/i, "Worker onboarding must document the Master-issued Worker ID as authoritative");
expect(paths.workerDoc, entries.workerDoc, /(?:保留|不得删除)[\s\S]*(?:独立凭据|worker-identity\.json)/i, "Worker onboarding must document credential-preserving retry");
expect(paths.upgradeDoc, entries.upgradeDoc, /worker-identity\.json[\s\S]*(?:drain|排空)/i, "Worker upgrade documentation must derive identity before drain");

if (failures.length > 0) {
  console.error(`Production deployment validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Production deployment validation passed.");
console.log("- Required services: Caddy, Dashboard, Master, PostgreSQL, Redis, MinIO");
console.log("- Published application port: 2808 only (RustDesk is optional/profile-gated)");
console.log("- Worker installers and transactional upgrade/rollback flows: present");
