[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PolicyPath,
  [switch]$RunRestoreDrill
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-RequiredDirectory {
  param([string]$Path, [string]$Label)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw "$Label is required" }
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
  return (Resolve-Path -LiteralPath $Path).Path
}

function Test-ChildPath {
  param([string]$Parent, [string]$Child)
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $childFull = [IO.Path]::GetFullPath($Child).TrimEnd('\') + '\'
  return $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)
}

function Copy-BackupVerified {
  param([string]$Source, [string]$DestinationRoot)
  $sourceResolved = (Resolve-Path -LiteralPath $Source).Path
  $destinationBase = Resolve-RequiredDirectory -Path $DestinationRoot -Label 'offHostDestinationRoot'
  $destination = Join-Path $destinationBase (Split-Path -Leaf $sourceResolved)
  if (Test-Path -LiteralPath $destination) { throw "Off-host backup destination already exists" }
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  & robocopy.exe $sourceResolved $destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:5 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Off-host backup copy failed with robocopy code $LASTEXITCODE" }

  $sourceFiles = @(Get-ChildItem -LiteralPath $sourceResolved -File -Recurse | ForEach-Object {
    [pscustomobject]@{ Relative = $_.FullName.Substring($sourceResolved.Length).TrimStart('\'); Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
  })
  $destinationFiles = @(Get-ChildItem -LiteralPath $destination -File -Recurse)
  if ($sourceFiles.Count -ne $destinationFiles.Count) { throw 'Off-host backup file count mismatch' }
  foreach ($file in $sourceFiles) {
    $copyPath = Join-Path $destination $file.Relative
    if (-not (Test-Path -LiteralPath $copyPath -PathType Leaf)) { throw "Off-host backup file missing" }
    if ((Get-FileHash -LiteralPath $copyPath -Algorithm SHA256).Hash -ne $file.Hash) { throw "Off-host backup checksum mismatch" }
  }
  return $destination
}

function Remove-ExpiredBackups {
  param([string]$Root, [int]$RetentionDays, [int]$MinimumCopies)
  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
  $candidates = @(Get-ChildItem -LiteralPath $resolvedRoot -Directory -Filter 'scheduled-*' | Sort-Object LastWriteTimeUtc -Descending)
  $removed = 0
  foreach ($candidate in @($candidates | Select-Object -Skip $MinimumCopies)) {
    if ($candidate.LastWriteTimeUtc -ge [DateTime]::UtcNow.AddDays(-$RetentionDays)) { continue }
    if (-not (Test-ChildPath -Parent $resolvedRoot -Child $candidate.FullName)) { throw 'Retention boundary validation failed' }
    Remove-Item -LiteralPath $candidate.FullName -Recurse -Force
    $removed++
  }
  return $removed
}

$resolvedPolicy = (Resolve-Path -LiteralPath $PolicyPath).Path
$policy = Get-Content -LiteralPath $resolvedPolicy -Raw -Encoding UTF8 | ConvertFrom-Json
$installRoot = [string]$policy.installRoot
$localRoot = Resolve-RequiredDirectory -Path ([string]$policy.localBackupRoot) -Label 'localBackupRoot'
$retentionDays = if ($policy.retentionDays) { [int]$policy.retentionDays } else { 14 }
$minimumCopies = if ($policy.minimumCopies) { [int]$policy.minimumCopies } else { 2 }
if ($retentionDays -lt 1 -or $minimumCopies -lt 2) { throw 'Retention requires at least 1 day and 2 copies' }

$backupScript = Join-Path $installRoot 'app\deploy\windows\backup-master.ps1'
$restoreScript = Join-Path $installRoot 'app\deploy\windows\restore-drill.ps1'
if (-not (Test-Path -LiteralPath $backupScript -PathType Leaf)) { throw 'backup-master.ps1 was not found' }
if (-not (Test-Path -LiteralPath $restoreScript -PathType Leaf)) { throw 'restore-drill.ps1 was not found' }

$backupJson = & $backupScript -InstallRoot $installRoot -ProjectName ([string]$policy.projectName) -MasterUrl ([string]$policy.masterUrl) -BackupDestinationRoot $localRoot -BackupPrefix 'scheduled'
$backup = $backupJson | ConvertFrom-Json
$backupRoot = (Resolve-Path -LiteralPath ([string]$backup.backupRoot)).Path
$offHostRoot = [string]$policy.offHostDestinationRoot
$offHostCopy = $null
if (-not [string]::IsNullOrWhiteSpace($offHostRoot)) {
  $offHostCopy = Copy-BackupVerified -Source $backupRoot -DestinationRoot $offHostRoot
} elseif ($policy.requireOffHostCopy -eq $true) {
  throw 'Off-host backup is required but offHostDestinationRoot is empty'
}

$restore = $null
if ($RunRestoreDrill) {
  $restore = (& $restoreScript -BackupRoot $backupRoot -ProjectName ([string]$policy.projectName)) | ConvertFrom-Json
  if ($restore.status -ne 'pass') { throw 'Restore drill did not pass' }
}

$localRemoved = Remove-ExpiredBackups -Root $localRoot -RetentionDays $retentionDays -MinimumCopies $minimumCopies
$offHostRemoved = 0
if ($offHostCopy) {
  $offHostRemoved = Remove-ExpiredBackups -Root $offHostRoot -RetentionDays $retentionDays -MinimumCopies $minimumCopies
}

$statusRoot = Join-Path $installRoot 'handoff\evidence\backup-status'
New-Item -ItemType Directory -Path $statusRoot -Force | Out-Null
$status = [ordered]@{
  status = 'pass'
  completedAt = [DateTimeOffset]::UtcNow.ToString('o')
  backupRoot = $backupRoot
  offHostCopy = $offHostCopy
  restoreDrill = if ($restore) { $restore.status } else { 'not_requested' }
  localRemoved = $localRemoved
  offHostRemoved = $offHostRemoved
}
[IO.File]::WriteAllText((Join-Path $statusRoot 'latest.json'), ($status | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
$status | ConvertTo-Json -Compress
