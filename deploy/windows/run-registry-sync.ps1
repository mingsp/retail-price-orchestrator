[CmdletBinding()]
param(
  [string]$WorkspaceRoot = 'D:\SpanAI\retail-radar-master\app',
  [string]$ConfigPath = 'D:\SpanAI\retail-radar-master\config\registry-sync.env',
  [string]$LogRoot = 'D:\SpanAI\retail-radar-master\logs',
  [string]$MasterCaCertificatePath = 'D:\SpanAI\retail-radar-master\certificates\master-root.crt'
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$mutex = [Threading.Mutex]::new($false, 'Global\RetailRadarDingTalkRegistrySync')
$hasMutex = $false
try {
  $hasMutex = $mutex.WaitOne(0)
  if (-not $hasMutex) { exit 0 }
  if (-not (Test-Path -LiteralPath $WorkspaceRoot -PathType Container)) { throw 'registry_sync_workspace_missing' }
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'registry_sync_config_missing' }
  New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
  $logPath = Join-Path $LogRoot ("registry-sync-{0}.jsonl" -f (Get-Date -Format 'yyyyMMdd'))
  Get-Content -LiteralPath $ConfigPath -Encoding UTF8 | ForEach-Object {
    if ($_ -and -not $_.StartsWith('#')) {
      $parts = $_.Split('=', 2)
      if ($parts.Count -eq 2) { [Environment]::SetEnvironmentVariable($parts[0], $parts[1], 'Process') }
    }
  }
  $env:NODE_EXTRA_CA_CERTS = $MasterCaCertificatePath
  if ($env:REGISTRY_SYNC_MODE -ne 'publish') {
    $env:REGISTRY_SYNC_MODE = 'dry_run'
    $env:REGISTRY_ALLOW_PUBLISH = 'false'
    $env:REGISTRY_WRITEBACK_ENABLED = 'false'
  }
  Set-Location $WorkspaceRoot
  $startedAt = Get-Date
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = (& pnpm registry:sync 2>&1 | ForEach-Object { [string]$_ } | Out-String).Trim()
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  $summary = $output -split "`r?`n" | Where-Object { $_ -match '^\{"success":' } | Select-Object -Last 1
  $safeFailure = if ($exitCode -eq 0) { $null } else {
    $match = [regex]::Match($output, '(?i)\b(?:registry|dws|missing_environment)[A-Za-z0-9_:.-]{1,150}\b')
    if ($match.Success) { $match.Value } else { 'registry_sync_command_failed' }
  }
  $event = [ordered]@{
    timestamp = (Get-Date).ToString('O')
    startedAt = $startedAt.ToString('O')
    mode = $env:REGISTRY_SYNC_MODE
    success = ($exitCode -eq 0)
    summary = if ($summary) { $summary | ConvertFrom-Json } else { $null }
    errorCode = $safeFailure
  }
  Add-Content -LiteralPath $logPath -Value ($event | ConvertTo-Json -Compress -Depth 5) -Encoding UTF8
  exit $exitCode
} catch {
  try {
    New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
    $event = [ordered]@{
      timestamp = (Get-Date).ToString('O')
      mode = 'unknown'
      success = $false
      errorCode = if ($_.Exception.Message -match '^[A-Za-z0-9_:.-]{1,160}$') { $_.Exception.Message } else { 'registry_sync_runner_failed' }
    }
    Add-Content -LiteralPath (Join-Path $LogRoot ("registry-sync-{0}.jsonl" -f (Get-Date -Format 'yyyyMMdd'))) `
      -Value ($event | ConvertTo-Json -Compress) -Encoding UTF8
  } catch {}
  exit 1
} finally {
  if ($hasMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
