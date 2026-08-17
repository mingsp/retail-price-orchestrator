[CmdletBinding()]
param(
  [ValidateRange(1, 32)][int]$CaptureConcurrency,
  [ValidateRange(1, 128)][int]$CaptureQueueMax,
  [ValidateRange(0.50, 0.98)][double]$MemoryShrinkRatio = 0.96,
  [ValidateRange(0.60, 1.00)][double]$MemoryStopRatio = 0.99,
  [string]$EnvironmentFile = 'C:\ProgramData\RetailRadar\Worker\config\worker.env',
  [string]$CdpStateFile = 'C:\ProgramData\RetailRadar\Worker\state\cdp-runtime-state.json',
  [string]$WorkerServiceName = 'RetailRadarWorker',
  [string]$CdpHelperTaskName = 'RetailRadarCdpHelper',
  [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

if ($MemoryStopRatio -le $MemoryShrinkRatio) {
  throw 'MemoryStopRatio must be greater than MemoryShrinkRatio'
}
if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw 'worker_environment_file_missing'
}
if (-not $SkipRestart) {
  if (-not (Get-Service -Name $WorkerServiceName -ErrorAction SilentlyContinue)) {
    throw 'worker_service_missing'
  }
  if (-not (Get-ScheduledTask -TaskName $CdpHelperTaskName -ErrorAction SilentlyContinue)) {
    throw 'cdp_helper_task_missing'
  }
}

$culture = [Globalization.CultureInfo]::InvariantCulture
$settings = [ordered]@{
  WORKER_CAPTURE_CONCURRENCY = [string]$CaptureConcurrency
  WORKER_CAPTURE_QUEUE_MAX = [string]$CaptureQueueMax
  WORKER_MEMORY_SHRINK_RATIO = $MemoryShrinkRatio.ToString('0.00', $culture)
  WORKER_MEMORY_STOP_RATIO = $MemoryStopRatio.ToString('0.00', $culture)
  WORKER_CDP_STATE_FILE = $CdpStateFile
}
$backup = "$EnvironmentFile.pre-resource-policy-$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
Copy-Item -LiteralPath $EnvironmentFile -Destination $backup

function Write-WorkerSettings {
  $lines = [Collections.Generic.List[string]]::new()
  foreach ($line in [IO.File]::ReadAllLines($EnvironmentFile)) { [void]$lines.Add($line) }

  foreach ($key in $settings.Keys) {
    $replacement = "$key=$($settings[$key])"
    $found = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
      if (-not $lines[$index].StartsWith("$key=")) { continue }
      if (-not $found) {
        $lines[$index] = $replacement
        $found = $true
      } else {
        $lines.RemoveAt($index)
        $index--
      }
    }
    if (-not $found) { [void]$lines.Add($replacement) }
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $CdpStateFile) -Force | Out-Null
  [IO.File]::WriteAllLines($EnvironmentFile, $lines, [Text.UTF8Encoding]::new($false))
}

function Restart-WorkerRuntime {
  Restart-Service -Name $WorkerServiceName -Force
  Stop-ScheduledTask -TaskName $CdpHelperTaskName -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $CdpHelperTaskName

  $deadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Seconds 2
    $service = (Get-Service -Name $WorkerServiceName).Status
    $helper = (Get-ScheduledTask -TaskName $CdpHelperTaskName).State
  } while (($service -ne 'Running' -or $helper -ne 'Running') -and (Get-Date) -lt $deadline)

  if ($service -ne 'Running' -or $helper -ne 'Running') {
    throw 'worker_runtime_restart_failed'
  }
  return [pscustomobject]@{ service = [string]$service; helper = [string]$helper }
}

try {
  Write-WorkerSettings
  $runtime = if ($SkipRestart) {
    [pscustomobject]@{ service = 'not_restarted'; helper = 'not_restarted' }
  } else {
    Restart-WorkerRuntime
  }
} catch {
  Copy-Item -LiteralPath $backup -Destination $EnvironmentFile -Force
  if (-not $SkipRestart) {
    try { Restart-WorkerRuntime | Out-Null } catch { Write-Warning 'worker_runtime_rollback_restart_failed' }
  }
  throw
}

[pscustomobject]@{
  success = $true
  computer = $env:COMPUTERNAME
  backup = $backup
  service = $runtime.service
  helper = $runtime.helper
  settings = $settings
} | ConvertTo-Json -Depth 4 -Compress
