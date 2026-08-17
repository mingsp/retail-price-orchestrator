[CmdletBinding()]
param(
    [string]$ProjectRoot = 'C:\SpanAI\retail-radar-xcgjz',
    [string]$StateRoot = 'C:\ProgramData\RetailRadar\Standalone',
    [ValidatePattern('^(?:\d{1,3}\.){3}\d{1,3}$')]
    [string]$MasterHost = '127.0.0.1',
    [string]$DingTalkWebhookUrl = 'REPLACE_BEFORE_GO_LIVE'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell session'
}

$project = [IO.Path]::GetFullPath($ProjectRoot)
$state = [IO.Path]::GetFullPath($StateRoot)
foreach ($required in @(
    (Join-Path $project 'package.json'),
    (Join-Path $project 'infra\docker-compose.production.yml'),
    (Join-Path $project 'deploy\dingtalk\production-registry.schema.json'),
    (Join-Path $project 'deploy\windows\start-standalone-node.ps1')
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required project file is missing: $required"
    }
}

$configRoot = Join-Path $state 'config'
$certificateRoot = Join-Path $state 'certificates'
$backupRoot = Join-Path $state 'backups'
$logRoot = Join-Path $state 'logs'
$environmentPath = Join-Path $configRoot '.env.production'
if (Test-Path -LiteralPath $environmentPath -PathType Leaf) {
    throw "Private environment already exists; refusing to overwrite: $environmentPath"
}

New-Item -ItemType Directory -Force -Path $configRoot, $certificateRoot, $backupRoot, $logRoot | Out-Null
foreach ($directory in @($configRoot, $certificateRoot)) {
    & icacls.exe $directory /inheritance:r /grant:r `
        'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' "${env:USERNAME}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to secure directory: $directory" }
}

function New-Secret([int]$Bytes = 32) {
    $buffer = New-Object byte[] $Bytes
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$postgresPassword = New-Secret
$redisPassword = New-Secret
$minioUser = 'rr66_' + (New-Secret 12).ToLowerInvariant()
$minioPassword = New-Secret
$postgresEncoded = [uri]::EscapeDataString($postgresPassword)
$redisEncoded = [uri]::EscapeDataString($redisPassword)
$schemaHash = (Get-FileHash -LiteralPath (Join-Path $project 'deploy\dingtalk\production-registry.schema.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$publicBaseUrl = "https://${MasterHost}:2808"

$lines = @(
    "MASTER_HOSTNAME=$MasterHost",
    "MASTER_PUBLIC_BASE_URL=$publicBaseUrl",
    'RETAIL_RADAR_VERSION=0.1.0',
    'POSTGRES_USER=retail',
    'POSTGRES_DB=retail_orchestrator',
    "POSTGRES_PASSWORD=$postgresPassword",
    "DATABASE_URL=postgres://retail:${postgresEncoded}@postgres:5432/retail_orchestrator",
    "REDIS_PASSWORD=$redisPassword",
    "REDIS_URL=redis://:${redisEncoded}@redis:6379",
    "MINIO_ROOT_USER=$minioUser",
    "MINIO_ROOT_PASSWORD=$minioPassword",
    "WORKER_SHARED_TOKEN=$(New-Secret)",
    "AUTOMATION_TOKEN=$(New-Secret)",
    "OPERATOR_TOKEN=$(New-Secret)",
    "REGISTRY_SYNC_TOKEN=$(New-Secret)",
    "REGISTRY_SCHEMA_HASH=$schemaHash",
    "OPERATOR_ALLOWED_ORIGINS=$publicBaseUrl",
    "DINGTALK_WEBHOOK_URL=$DingTalkWebhookUrl"
)
[IO.File]::WriteAllLines($environmentPath, $lines, [Text.UTF8Encoding]::new($false))
& icacls.exe $environmentPath /inheritance:r /grant:r `
    'SYSTEM:F' 'BUILTIN\Administrators:F' "${env:USERNAME}:F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the private environment file' }

$dockerTaskName = 'RetailRadarDockerDesktop'
$startTaskName = 'RetailRadarStandaloneStart'
$dockerPath = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
if (-not (Test-Path -LiteralPath $dockerPath -PathType Leaf)) { throw 'Docker Desktop is not installed' }
$startScript = Join-Path $project 'deploy\windows\start-standalone-node.ps1'
$interactiveUser = $identity.Name

$dockerAction = New-ScheduledTaskAction -Execute $dockerPath -Argument '--accept-license --disable-hardware-acceleration'
$dockerTrigger = New-ScheduledTaskTrigger -AtLogOn -User $interactiveUser
$interactivePrincipal = New-ScheduledTaskPrincipal -UserId $interactiveUser -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $dockerTaskName -Action $dockerAction -Trigger $dockerTrigger `
    -Principal $interactivePrincipal -Settings $settings -Force | Out-Null

$startArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -ProjectRoot `"$project`" -StateRoot `"$state`""
$startAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $startArguments
$startTrigger = New-ScheduledTaskTrigger -AtLogOn -User $interactiveUser
$startTrigger.Delay = 'PT45S'
Register-ScheduledTask -TaskName $startTaskName -Action $startAction -Trigger $startTrigger `
    -Principal $interactivePrincipal -Settings $settings -Force | Out-Null

[pscustomobject]@{
    status = 'initialized'
    projectRoot = $project
    stateRoot = $state
    environmentFile = $environmentPath
    masterUrl = $publicBaseUrl
    dockerTask = $dockerTaskName
    systemTask = $startTaskName
    dingTalkConfigured = $DingTalkWebhookUrl -notmatch 'REPLACE_BEFORE_GO_LIVE'
} | ConvertTo-Json -Compress
