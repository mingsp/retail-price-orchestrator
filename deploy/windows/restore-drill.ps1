[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BackupRoot,
    [string]$ProjectName = 'retail-radar'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedBackup = (Resolve-Path -LiteralPath $BackupRoot).Path
$manifestPath = Join-Path $resolvedBackup 'backup-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'backup-manifest.json was not found' }
$manifest = Get-Content -Raw -LiteralPath $manifestPath -Encoding UTF8 | ConvertFrom-Json
$backupCreatedAt = [DateTimeOffset]::Parse([string]$manifest.createdAt).ToUniversalTime()
$dumpPath = Join-Path $resolvedBackup ([string]$manifest.postgresDump.file)
$minioPath = Join-Path $resolvedBackup ([string]$manifest.minioArchive.file)
foreach ($item in @(
    @{ Path = $dumpPath; Sha256 = [string]$manifest.postgresDump.sha256 },
    @{ Path = $minioPath; Sha256 = [string]$manifest.minioArchive.sha256 }
)) {
    if (-not (Test-Path -LiteralPath $item.Path -PathType Leaf)) { throw "Backup artifact is missing: $($item.Path)" }
    $actual = (Get-FileHash -LiteralPath $item.Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $item.Sha256.ToLowerInvariant()) { throw "Backup checksum mismatch: $($item.Path)" }
}

$postgresContainers = @(& docker.exe ps --filter "label=com.docker.compose.project=$ProjectName" --filter 'label=com.docker.compose.service=postgres' --format '{{.Names}}')
if ($postgresContainers.Count -ne 1) { throw "Expected one PostgreSQL container; found $($postgresContainers.Count)" }
$postgresContainer = [string]$postgresContainers[0]
$inspect = @(& docker.exe inspect $postgresContainer | ConvertFrom-Json)[0]
$userLine = @($inspect.Config.Env | Where-Object { $_.StartsWith('POSTGRES_USER=') } | Select-Object -First 1)
$postgresUser = if ($userLine.Count) { $userLine[0].Substring('POSTGRES_USER='.Length) } else { 'retail' }
$suffix = (Get-Date -Format 'yyyyMMddHHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$restoreDb = "retail_restore_drill_$($suffix -replace '-','_')"
$restoreVolume = "retail_restore_drill_$($suffix.ToLowerInvariant())"
$containerDump = "/tmp/$restoreDb.dump"
$startedAt = Get-Date
$createdDb = $false
$createdVolume = $false

try {
    & docker.exe cp $dumpPath "${postgresContainer}:$containerDump"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to stage PostgreSQL dump' }
    & docker.exe exec $postgresContainer createdb -U $postgresUser $restoreDb
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create isolated restore database' }
    $createdDb = $true
    & docker.exe exec $postgresContainer pg_restore -U $postgresUser -d $restoreDb --clean --if-exists $containerDump
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL restore drill failed' }

    $restoredCounts = [ordered]@{}
    foreach ($property in $manifest.criticalTableCounts.PSObject.Properties) {
        $value = @(& docker.exe exec $postgresContainer psql -U $postgresUser -d $restoreDb -Atc "SELECT count(*) FROM $($property.Name)")
        if ($LASTEXITCODE -ne 0 -or $value.Count -eq 0) { throw "Failed to validate restored table $($property.Name)" }
        $actualCount = [int64]$value[-1]
        if ($actualCount -ne [int64]$property.Value) { throw "Restored row count mismatch for $($property.Name)" }
        $restoredCounts[$property.Name] = $actualCount
    }

    & docker.exe volume create $restoreVolume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create isolated MinIO restore volume' }
    $createdVolume = $true
    & docker.exe run --rm --mount "type=bind,source=$resolvedBackup,target=/backup,readonly" --mount "type=volume,source=$restoreVolume,target=/restore" alpine:3.21.3 sh -c "tar -C /restore -xf /backup/$([string]$manifest.minioArchive.file)"
    if ($LASTEXITCODE -ne 0) { throw 'MinIO volume restore drill failed' }
    $restoredEntries = @(& docker.exe run --rm --mount "type=volume,source=$restoreVolume,target=/restore,readonly" alpine:3.21.3 sh -c "find /restore -mindepth 1 -type f -print")
    if ($LASTEXITCODE -ne 0 -or $restoredEntries.Count -ne [int]$manifest.minioArchive.catalogLines) {
        throw 'Restored MinIO object/version catalog count mismatch'
    }

    $result = [ordered]@{
        status = 'pass'
        backupCreatedAt = [string]$manifest.createdAt
        restoredAt = (Get-Date).ToUniversalTime().ToString('o')
        rpoSecondsAtDrill = [math]::Max(0, [int]([DateTimeOffset]::UtcNow.Subtract($backupCreatedAt).TotalSeconds))
        rtoSeconds = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 3)
        database = $restoreDb
        criticalTableCounts = $restoredCounts
        minioCatalogLines = $restoredEntries.Count
    }
    $resultPath = Join-Path $resolvedBackup 'restore-drill-result.json'
    [IO.File]::WriteAllText($resultPath, ($result | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    $result | ConvertTo-Json -Compress -Depth 8
}
finally {
    & docker.exe exec $postgresContainer rm -f $containerDump 2>$null | Out-Null
    if ($createdDb) {
        & docker.exe exec $postgresContainer dropdb -U $postgresUser --if-exists $restoreDb 2>$null | Out-Null
    }
    if ($createdVolume) {
        & docker.exe volume rm $restoreVolume 2>$null | Out-Null
    }
}
