[CmdletBinding()]
param(
    [string]$InstallRoot = 'D:\SpanAI\retail-radar-master',
    [string]$ProjectName = 'retail-radar',
    [string]$MasterUrl = 'https://127.0.0.1:2808'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-LabelValue($Labels, [string]$Name) {
    $property = $Labels.PSObject.Properties[$Name]
    if ($property) { return $property.Value }
    return $null
}

$containers = @(& docker.exe ps --filter "label=com.docker.compose.project=$ProjectName" --format '{{.Names}}')
$postgresContainers = @(
    & docker.exe ps `
        --filter "label=com.docker.compose.project=$ProjectName" `
        --filter 'label=com.docker.compose.service=postgres' `
        --format '{{.Names}}'
)
if ($postgresContainers.Count -ne 1) {
    throw "Expected one PostgreSQL container; found $($postgresContainers.Count)"
}

$postgresContainer = [string]$postgresContainers[0]
$postgresInspect = @(& docker.exe inspect $postgresContainer | ConvertFrom-Json)[0]
$postgresUserLine = @($postgresInspect.Config.Env | Where-Object { $_.StartsWith('POSTGRES_USER=') } | Select-Object -First 1)
$postgresDbLine = @($postgresInspect.Config.Env | Where-Object { $_.StartsWith('POSTGRES_DB=') } | Select-Object -First 1)
$postgresUser = if ($postgresUserLine.Count) { $postgresUserLine[0].Substring('POSTGRES_USER='.Length) } else { 'retail' }
$postgresDb = if ($postgresDbLine.Count) { $postgresDbLine[0].Substring('POSTGRES_DB='.Length) } else { 'retail_orchestrator' }
$activeTaskSql = "SELECT count(*) FROM category_tasks WHERE status IN ('pending','assigned','running','paused','manual_required')"
$activeTaskResult = @(& docker.exe exec $postgresContainer psql -U $postgresUser -d $postgresDb -Atc $activeTaskSql)
if ($LASTEXITCODE -ne 0 -or $activeTaskResult.Count -eq 0) {
    throw 'Database task precheck failed'
}
$activeTaskCount = [int]$activeTaskResult[-1]
if ($activeTaskCount -gt 0) {
    throw "Deployment window is blocked by $activeTaskCount active tasks"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $InstallRoot "backups\predeploy-$timestamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
& icacls.exe $backupRoot /inheritance:r /grant:r `
    'SYSTEM:(OI)(CI)F' `
    'BUILTIN\Administrators:(OI)(CI)F' `
    "${env:USERNAME}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the backup directory' }

$containerDump = "/tmp/predeploy-$timestamp.dump"
$dumpPath = Join-Path $backupRoot 'postgres.dump'
try {
    & docker.exe exec $postgresContainer pg_dump -U $postgresUser -d $postgresDb -Fc -f $containerDump
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }

    $catalog = @(& docker.exe exec $postgresContainer pg_restore -l $containerDump)
    if ($LASTEXITCODE -ne 0 -or $catalog.Count -eq 0) {
        throw 'pg_restore catalog validation failed'
    }

    & docker.exe cp "${postgresContainer}:$containerDump" $dumpPath
    if ($LASTEXITCODE -ne 0) { throw 'Copying the PostgreSQL dump failed' }
}
finally {
    & docker.exe exec $postgresContainer rm -f $containerDump 2>$null | Out-Null
}

$copySpecs = @(
    @{ Source = (Join-Path $InstallRoot 'config\production-deploy.env'); Name = 'production-deploy.env' },
    @{ Source = (Join-Path $InstallRoot 'app\.env.production'); Name = 'legacy-app.env.production' },
    @{ Source = (Join-Path $InstallRoot 'app\infra\docker-compose.production.yml'); Name = 'legacy-app-docker-compose.production.yml' },
    @{ Source = (Join-Path $InstallRoot 'app\infra\caddy\Caddyfile'); Name = 'legacy-app-Caddyfile' },
    @{ Source = (Join-Path $InstallRoot 'workspace\retail-price-orchestrator\infra\docker-compose.production.yml'); Name = 'legacy-workspace-docker-compose.production.yml' },
    @{ Source = (Join-Path $InstallRoot 'workspace\retail-price-orchestrator\infra\caddy\Caddyfile'); Name = 'legacy-workspace-Caddyfile' }
)

$copiedConfigs = @()
foreach ($spec in $copySpecs) {
    if (-not (Test-Path -LiteralPath $spec.Source -PathType Leaf)) { continue }
    $destination = Join-Path $backupRoot $spec.Name
    Copy-Item -LiteralPath $spec.Source -Destination $destination
    $copiedConfigs += [pscustomobject]@{
        name = $spec.Name
        sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

$runtime = @()
foreach ($containerName in $containers) {
    $inspect = @(& docker.exe inspect $containerName | ConvertFrom-Json)[0]
    $labels = $inspect.Config.Labels
    $healthProperty = $inspect.State.PSObject.Properties['Health']
    $runtime += [pscustomobject]@{
        name = $containerName
        image = $inspect.Config.Image
        imageId = $inspect.Image
        state = $inspect.State.Status
        health = if ($healthProperty) { $healthProperty.Value.Status } else { $null }
        composeWorkingDir = Get-LabelValue $labels 'com.docker.compose.project.working_dir'
        composeConfigFiles = Get-LabelValue $labels 'com.docker.compose.project.config_files'
        composeEnvironmentFiles = Get-LabelValue $labels 'com.docker.compose.project.environment_file'
    }
}

$dumpInfo = [ordered]@{
    file = 'postgres.dump'
    size = (Get-Item -LiteralPath $dumpPath).Length
    sha256 = (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant()
    catalogLines = $catalog.Count
}
$manifest = [ordered]@{
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    activeTaskCount = $activeTaskCount
    postgresDump = $dumpInfo
    copiedConfigs = $copiedConfigs
    containers = $runtime
}
$manifestPath = Join-Path $backupRoot 'backup-manifest.json'
[IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 8),
    [Text.UTF8Encoding]::new($false)
)

[pscustomobject]@{
    backupRoot = $backupRoot
    activeTasks = $activeTaskCount
    dumpSize = $dumpInfo.size
    dumpSha256 = $dumpInfo.sha256
    catalogLines = $dumpInfo.catalogLines
    configBackups = $copiedConfigs.Count
    containers = $runtime.Count
} | ConvertTo-Json -Compress
