[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9._-]+$')][string]$Version,
  [string]$WorkspaceRoot = 'D:\SpanAI\retail-radar-master\workspace\retail-price-orchestrator',
  [string]$ConfigRoot = 'D:\SpanAI\retail-radar-master\config'
)

$ErrorActionPreference = 'Stop'

function Get-ContainerEnvironment([string]$Name) {
  $id = docker ps --filter "name=$Name" --format '{{.ID}}' | Select-Object -First 1
  if (-not $id) { throw "container_not_found:$Name" }
  $values = @{}
  foreach ($line in (docker inspect $id | ConvertFrom-Json)[0].Config.Env) {
    $parts = $line.Split('=', 2)
    if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1] }
  }
  return $values
}

function Read-KeyValueFile([string]$Path) {
  $values = @{}
  Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
    if ($_ -and -not $_.StartsWith('#')) {
      $parts = $_.Split('=', 2)
      if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1] }
    }
  }
  return $values
}

$master = Get-ContainerEnvironment 'retail-radar-master-1'
$caddy = Get-ContainerEnvironment 'retail-radar-caddy-1'
$postgres = Get-ContainerEnvironment 'retail-radar-postgres-1'
$redis = Get-ContainerEnvironment 'retail-radar-redis-1'
$minio = Get-ContainerEnvironment 'retail-radar-minio-1'
$registry = Read-KeyValueFile (Join-Path $ConfigRoot 'registry-sync.env')
$state = Get-Content -Raw -LiteralPath (Join-Path $ConfigRoot 'registry-state.json') -Encoding UTF8 | ConvertFrom-Json

$deployment = [ordered]@{
  MASTER_HOSTNAME = $caddy['MASTER_HOSTNAME']
  MASTER_PUBLIC_BASE_URL = $master['MASTER_PUBLIC_BASE_URL']
  RETAIL_RADAR_VERSION = $Version
  DATABASE_URL = $master['DATABASE_URL']
  REDIS_URL = $master['REDIS_URL']
  MINIO_ROOT_USER = $minio['MINIO_ROOT_USER']
  MINIO_ROOT_PASSWORD = $minio['MINIO_ROOT_PASSWORD']
  S3_REGION = $master['S3_REGION']
  WORKER_SHARED_TOKEN = $master['WORKER_SHARED_TOKEN']
  AUTOMATION_TOKEN = $master['AUTOMATION_TOKEN']
  OPERATOR_TOKEN = $master['OPERATOR_TOKEN']
  OPERATOR_ALLOWED_ORIGINS = $master['OPERATOR_ALLOWED_ORIGINS']
  DINGTALK_WEBHOOK_URL = $master['DINGTALK_WEBHOOK_URL']
  REGISTRY_SYNC_TOKEN = $registry['MASTER_REGISTRY_SYNC_TOKEN']
  REGISTRY_SCHEMA_HASH = $state.schemaHash
  POSTGRES_USER = $postgres['POSTGRES_USER']
  POSTGRES_PASSWORD = $postgres['POSTGRES_PASSWORD']
  POSTGRES_DB = $postgres['POSTGRES_DB']
  REDIS_PASSWORD = $redis['REDIS_PASSWORD']
}

foreach ($entry in $deployment.GetEnumerator()) {
  if ([string]::IsNullOrWhiteSpace([string]$entry.Value)) { throw "deployment_value_missing:$($entry.Key)" }
}

$environmentPath = Join-Path $ConfigRoot 'production-deploy.env'
[IO.File]::WriteAllLines(
  $environmentPath,
  @($deployment.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }),
  [Text.UTF8Encoding]::new($false)
)
& icacls.exe $environmentPath /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' "$env:USERNAME`:F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'deployment_env_acl_failed' }

$beforeChrome = @(Get-Process chrome -ErrorAction SilentlyContinue).Count
$oldImage = (docker inspect retail-radar-master-1 | ConvertFrom-Json)[0].Config.Image
if (docker ps --format '{{.Names}}' | Where-Object { $_ -eq 'retail-radar-master-registry-canary' }) {
  docker stop -t 10 retail-radar-master-registry-canary | Out-Null
}

Set-Location (Join-Path $WorkspaceRoot 'infra')
docker compose --project-name retail-radar --env-file $environmentPath -f docker-compose.production.yml up -d --no-deps master
if ($LASTEXITCODE -ne 0) { throw 'master_compose_cutover_failed' }

$ready = $false
for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  Start-Sleep -Seconds 2
  try {
    $raw = & curl.exe -ksS --max-time 5 "$($deployment['MASTER_PUBLIC_BASE_URL'].TrimEnd('/'))/ready"
    if ($LASTEXITCODE -ne 0) { continue }
    $response = $raw | ConvertFrom-Json
    if ($response.ok) { $ready = $true; break }
  } catch {}
}
if (-not $ready) {
  docker logs --tail 80 retail-radar-master-1
  throw 'production_master_not_ready'
}

[pscustomobject]@{
  Ready = $true
  OldImage = $oldImage
  NewImage = (docker inspect retail-radar-master-1 | ConvertFrom-Json)[0].Config.Image
  ChromeBefore = $beforeChrome
  ChromeAfter = @(Get-Process chrome -ErrorAction SilentlyContinue).Count
  Containers = @(docker ps --filter 'name=retail-radar-' --format '{{.Names}} {{.Status}}')
} | ConvertTo-Json -Depth 4 -Compress
