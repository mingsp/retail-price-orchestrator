[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ManifestUrl,
  [Parameter(Mandatory = $true)][string]$MasterUrl,
  [Parameter(Mandatory = $true)][string]$CurrentMasterVersion,
  [Parameter(Mandatory = $true)][string]$ReleasePublicKeyPath,
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9._-]{1,64}$")][string]$ReleaseKeyId,
  [string]$AutomationToken,
  [string]$InstallRoot = "$env:ProgramData\RetailRadar\Worker",
  [string]$ManifestVerifierPath = "",
  [int]$DrainTimeoutSeconds = 300,
  [int]$HealthTimeoutSeconds = 180,
  [int]$StableHealthSeconds = 30,
  [switch]$InstallOnly,
  [switch]$HeartbeatOnly
)

$ErrorActionPreference = "Stop"
$ServiceName = "RetailRadarWorker"
$CdpHelperTaskName = "RetailRadarCdpHelper"
$ReleaseRoot = Join-Path $InstallRoot "releases"
$CurrentLink = Join-Path $InstallRoot "current"
$PreviousLink = Join-Path $InstallRoot "current.previous"
$NextLink = Join-Path $InstallRoot "current.next"
$WorkRoot = Join-Path $InstallRoot "work"
$DrainJournal = Join-Path $WorkRoot "upgrade-drained-tasks.json"
$IdentityFile = Join-Path $InstallRoot "state\worker-identity.json"
if (-not $ManifestVerifierPath) { $ManifestVerifierPath = Join-Path $InstallRoot "service\verify-release-manifest.mjs" }

function Assert-HttpsUrl([string]$Value, [string]$Name) {
  $uri = [uri]$Value
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https" -or $uri.UserInfo) { throw "$Name must be an HTTPS URL without embedded credentials" }
}

function Assert-SemVerAtLeast([string]$Actual, [string]$Minimum) {
  $actualCore = ($Actual -split "[-+]", 2)[0]
  $minimumCore = ($Minimum -split "[-+]", 2)[0]
  if ([version]$actualCore -lt [version]$minimumCore) { throw "Master $Actual is below the release minimum $Minimum" }
}

function Get-PersistedWorkerIdentity {
  if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) { throw "Worker identity file is missing: $IdentityFile" }
  try { $identity = Get-Content -Raw -LiteralPath $IdentityFile | ConvertFrom-Json } catch { throw "Worker identity file is invalid: $IdentityFile" }
  if (-not [string]$identity.workerId -or -not [string]$identity.workerToken) { throw "Worker identity file is incomplete: $IdentityFile" }
  return $identity
}

function Invoke-AutomationTaskAction([string]$TaskId, [string]$Action) {
  if (-not $AutomationToken) { throw "AutomationToken is required for transactional task drain and recovery" }
  $headers = @{ Authorization = "Bearer $AutomationToken" }
  Invoke-RestMethod -Method Post -Uri "$($MasterUrl.TrimEnd('/'))/api/automation/v1/tasks/$TaskId/$Action" `
    -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 15 | Out-Null
}

function Get-ActiveWorkerTasks {
  if (-not $AutomationToken) { throw "AutomationToken is required to query active Worker tasks" }
  $response = Invoke-RestMethod -Method Get `
    -Uri "$($MasterUrl.TrimEnd('/'))/api/automation/v1/workers/$WorkerId/active-tasks" `
    -Headers @{ Authorization = "Bearer $AutomationToken" } -TimeoutSec 15
  return @($response.tasks)
}

function Save-DrainJournal([string[]]$TaskIds) {
  $temporary = "$DrainJournal.$([guid]::NewGuid().ToString('N')).tmp"
  [IO.File]::WriteAllText($temporary, (@{ workerId = $WorkerId; taskIds = @($TaskIds | Sort-Object -Unique) } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $DrainJournal -Force
}

function Read-DrainJournal {
  if (-not (Test-Path -LiteralPath $DrainJournal -PathType Leaf)) { return @() }
  $journal = Get-Content -Raw -LiteralPath $DrainJournal | ConvertFrom-Json
  if ($journal.workerId -ne $WorkerId) { throw "drain journal belongs to another Worker" }
  return @($journal.taskIds | ForEach-Object { [string]$_ } | Where-Object { $_ })
}

function Resume-DrainedTasks {
  $pending = @(Read-DrainJournal)
  if ($pending.Count -eq 0) {
    if (Test-Path -LiteralPath $DrainJournal) { Remove-Item -LiteralPath $DrainJournal -Force }
    return
  }
  $deadline = (Get-Date).AddSeconds($DrainTimeoutSeconds)
  while ($pending.Count -gt 0 -and (Get-Date) -lt $deadline) {
    $remaining = @()
    foreach ($taskId in $pending) {
      try { Invoke-AutomationTaskAction $taskId "resume" } catch { $remaining += $taskId }
    }
    $pending = @($remaining)
    if ($pending.Count -gt 0) { Start-Sleep -Seconds 3 }
  }
  if ($pending.Count -gt 0) { throw "failed to resume drained tasks: $($pending -join ',')" }
  Remove-Item -LiteralPath $DrainJournal -Force
}

function Invoke-WorkerDrain {
  $taskIds = @(Read-DrainJournal)
  $deadline = (Get-Date).AddSeconds($DrainTimeoutSeconds)
  do {
    $active = @(Get-ActiveWorkerTasks)
    if ($active.Count -eq 0) { return }
    foreach ($task in $active) {
      if ($taskIds -notcontains $task.taskId) {
        $taskIds += [string]$task.taskId
        Save-DrainJournal $taskIds
      }
      Invoke-AutomationTaskAction ([string]$task.taskId) "pause"
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "drain timed out with $(@(Get-ActiveWorkerTasks).Count) active tasks"
}

function Get-WorkerState {
  try {
    $response = Invoke-RestMethod -Method Get -Uri "$($MasterUrl.TrimEnd('/'))/api/worker/self" `
      -Headers @{ Authorization = "Bearer $WorkerToken" } -TimeoutSec 10
    return $response.worker.worker
  } catch { return $null }
}

function Wait-WorkerHealth([string]$PreviousBootId, [string]$ExpectedVersion) {
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
  $stableSince = $null
  do {
    $worker = Get-WorkerState
    $matches = $worker -and $worker.status -eq "online" -and $worker.bootId `
      -and (!$PreviousBootId -or $worker.bootId -ne $PreviousBootId) -and $worker.agentVersion -eq $ExpectedVersion
    if ($matches) {
      if (-not $stableSince) { $stableSince = Get-Date }
      if (((Get-Date) - $stableSince).TotalSeconds -ge $StableHealthSeconds) { return }
    } else { $stableSince = $null }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)
  throw "health check failed: Worker did not remain online at version $ExpectedVersion for $StableHealthSeconds seconds"
}

function Remove-ManagedLink([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $item = Get-Item -LiteralPath $Path -Force
  if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Refusing to remove non-link path: $Path" }
  if ($item.PSIsContainer) {
    [IO.Directory]::Delete($item.FullName, $false)
  } else {
    [IO.File]::Delete($item.FullName)
  }
}

function Stop-WorkerServiceForUpgrade {
  $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  if (-not $service) { throw "Worker service was not found" }
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & sc.exe stop $ServiceName 2>$null | Out-Null
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
    $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  } while ($service -and $service.State -ne "Stopped" -and (Get-Date) -lt $deadline)
  if ($service -and $service.State -ne "Stopped" -and [int]$service.ProcessId -gt 0) {
    & taskkill.exe /PID ([int]$service.ProcessId) /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to terminate the Worker service process for upgrade" }
  }
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
    $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  } while ($service -and $service.State -ne "Stopped" -and (Get-Date) -lt $deadline)
  if (-not $service -or $service.State -ne "Stopped") { throw "Worker service did not stop for upgrade" }
}

function Restart-CdpHelper {
  $task = Get-ScheduledTask -TaskName $CdpHelperTaskName -ErrorAction SilentlyContinue
  if (-not $task) { throw "CDP helper scheduled task was not found" }
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Set-ScheduledTask -TaskName $CdpHelperTaskName -Settings $settings | Out-Null
  if ($task.State -in @("Running", "Queued")) {
    Stop-ScheduledTask -TaskName $CdpHelperTaskName
    $deadline = (Get-Date).AddSeconds(15)
    do {
      Start-Sleep -Milliseconds 500
      $task = Get-ScheduledTask -TaskName $CdpHelperTaskName -ErrorAction Stop
    } while ($task.State -in @("Running", "Queued") -and (Get-Date) -lt $deadline)
    if ($task.State -in @("Running", "Queued")) { throw "CDP helper did not stop for upgrade" }
  }
  Start-ScheduledTask -TaskName $CdpHelperTaskName
}

function Assert-HeartbeatOnlyConfiguration {
  $environmentFile = Join-Path $InstallRoot "config\worker.env"
  if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) { throw "Worker environment file was not found" }
  $lines = Get-Content -LiteralPath $environmentFile
  foreach ($required in @(
    "WORKER_ENABLE_TASK_POLLING=false",
    "WORKER_ENABLE_TASK_EXECUTION=false",
    "WORKER_ENABLE_CDP_COMMANDS=false",
    "WORKER_ACCOUNTS_JSON=[]",
    "WORKER_CDP_ENDPOINTS_JSON=[]"
  )) {
    if ($lines -notcontains $required) { throw "Heartbeat-only upgrade requires $required" }
  }
}

function Set-CurrentRelease([string]$Target) {
  if (Test-Path -LiteralPath $NextLink) { throw "stale current.next blocks release switch" }
  if (Test-Path -LiteralPath $PreviousLink) { throw "stale current.previous blocks release switch" }
  New-Item -ItemType Junction -Path $NextLink -Target $Target | Out-Null
  if (Test-Path -LiteralPath $CurrentLink) { Rename-Item -LiteralPath $CurrentLink -NewName (Split-Path -Leaf $PreviousLink) }
  Rename-Item -LiteralPath $NextLink -NewName (Split-Path -Leaf $CurrentLink)
}

function Remove-FailedRelease([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
  $resolvedRoot = [IO.Path]::GetFullPath($ReleaseRoot).TrimEnd('\') + '\'
  $resolvedPath = [IO.Path]::GetFullPath($Path)
  if (-not $resolvedPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "refusing to remove release outside release root" }
  $quarantineRoot = Join-Path $WorkRoot "quarantine"
  New-Item -ItemType Directory -Force -Path $quarantineRoot | Out-Null
  $destination = Join-Path $quarantineRoot ("$([IO.Path]::GetFileName($resolvedPath))-failed-" + (Get-Date -Format "yyyyMMdd-HHmmss-fff"))
  Move-Item -LiteralPath $resolvedPath -Destination $destination -ErrorAction Stop
}

Assert-HttpsUrl $MasterUrl "MasterUrl"
Assert-HttpsUrl $ManifestUrl "ManifestUrl"
if (-not (Test-Path -LiteralPath $ReleasePublicKeyPath -PathType Leaf)) { throw "Release public key was not found" }
if (-not (Test-Path -LiteralPath $ManifestVerifierPath -PathType Leaf)) { throw "Release manifest verifier was not found" }
New-Item -ItemType Directory -Force -Path $ReleaseRoot, $WorkRoot | Out-Null
$WorkerIdentity = if ($InstallOnly) { $null } else { Get-PersistedWorkerIdentity }
$WorkerId = if ($WorkerIdentity) { [string]$WorkerIdentity.workerId } else { "" }
$WorkerToken = if ($WorkerIdentity) { [string]$WorkerIdentity.workerToken } else { "" }
if ($HeartbeatOnly -and -not $InstallOnly) { Assert-HeartbeatOnlyConfiguration }

if (-not $InstallOnly -and -not $HeartbeatOnly -and (Test-Path -LiteralPath $DrainJournal)) {
  Write-Warning "Recovering tasks from an interrupted prior upgrade before starting a new transaction"
  Resume-DrainedTasks
}

$manifestFile = Join-Path $WorkRoot "manifest-$([guid]::NewGuid().ToString('N')).json"
Invoke-WebRequest -UseBasicParsing -Proxy $null -Uri $ManifestUrl -OutFile $manifestFile -TimeoutSec 30
$platform = "windows-x64"
$verifiedJson = & (Get-Command node -ErrorAction Stop).Source $ManifestVerifierPath `
  --manifest $manifestFile --public-key $ReleasePublicKeyPath --expected-key-id $ReleaseKeyId --platform $platform
if ($LASTEXITCODE -ne 0) { throw "release manifest signature verification failed" }
$verified = $verifiedJson | ConvertFrom-Json
Assert-SemVerAtLeast $CurrentMasterVersion $verified.minimumMasterVersion
Assert-HttpsUrl $verified.artifact.url "ArtifactUrl"

$ReleasePath = Join-Path $ReleaseRoot $verified.version
if (Test-Path -LiteralPath $ReleasePath) { throw "Release $($verified.version) already exists; clean interrupted release before retry" }
if ($InstallOnly -and (Test-Path -LiteralPath $CurrentLink)) { throw "InstallOnly requires an empty current release" }
if (Test-Path -LiteralPath $NextLink) { Remove-ManagedLink $NextLink }
if (Test-Path -LiteralPath $PreviousLink) { throw "interrupted release switch requires rollback before retry" }
if (-not $InstallOnly) {
  $currentItem = Get-Item -LiteralPath $CurrentLink -Force -ErrorAction Stop
  if (-not ($currentItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "current release path is not a managed link" }
}

$download = Join-Path $WorkRoot "$($verified.version)-$([guid]::NewGuid().ToString('N')).zip"
$staging = Join-Path $WorkRoot "$($verified.version)-$([guid]::NewGuid().ToString('N'))"
$oldState = if ($InstallOnly) { $null } else { Get-WorkerState }
if (-not $InstallOnly -and (-not $oldState -or -not $oldState.agentVersion)) { throw "cannot establish the current Worker version before upgrade" }
$serviceStopped = $false
$releaseCreated = $false
$transactionCommitted = $false

try {
  if (-not $InstallOnly) {
    # DEPLOY_PHASE: DRAIN
    if (-not $HeartbeatOnly) { Invoke-WorkerDrain }
    Stop-WorkerServiceForUpgrade
    $serviceStopped = $true
    if (-not $HeartbeatOnly -and @(Get-ActiveWorkerTasks).Count -gt 0) { throw "drain race detected after service stop" }
  }

  # DEPLOY_PHASE: DOWNLOAD
  Invoke-WebRequest -UseBasicParsing -Proxy $null -Uri $verified.artifact.url -OutFile $download -TimeoutSec 300

  # DEPLOY_PHASE: SHA256
  if ((Get-Item -LiteralPath $download).Length -ne [int64]$verified.artifact.sizeBytes) { throw "release artifact size mismatch" }
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash.ToLowerInvariant()
  if ($actualHash -ne ([string]$verified.artifact.sha256).ToLowerInvariant()) { throw "SHA256 mismatch for downloaded Worker release" }
  Expand-Archive -LiteralPath $download -DestinationPath $staging
  if (-not (Test-Path -LiteralPath (Join-Path $staging "dist\index.js") -PathType Leaf)) { throw "Worker release is missing dist/index.js" }
  Move-Item -LiteralPath $staging -Destination $ReleasePath
  $releaseCreated = $true

  # DEPLOY_PHASE: SWITCH
  Set-CurrentRelease $ReleasePath
  if ($InstallOnly) {
    $transactionCommitted = $true
    Write-Host "Installed immutable Worker release $($verified.version); service lifecycle was intentionally skipped."
    return
  }

  # DEPLOY_PHASE: RESTART
  Start-Service -Name $ServiceName
  Restart-CdpHelper

  # DEPLOY_PHASE: HEALTH
  Wait-WorkerHealth ([string]$oldState.bootId) ([string]$verified.version)
  if (-not $HeartbeatOnly) { Resume-DrainedTasks }
  Remove-ManagedLink $PreviousLink
  $serviceStopped = $false
  $transactionCommitted = $true
  Write-Host "Worker upgraded to $($verified.version), remained stable, and resumed drained tasks."
} catch {
  $upgradeError = $_
  if (-not $InstallOnly -and $serviceStopped) {
    # DEPLOY_PHASE: ROLLBACK
    Write-Warning "Upgrade failed; restoring previous release: $($upgradeError.Exception.Message)"
    $failedState = Get-WorkerState
    Stop-WorkerServiceForUpgrade
    try {
      if (Test-Path -LiteralPath $PreviousLink) {
        Remove-ManagedLink $CurrentLink
        Rename-Item -LiteralPath $PreviousLink -NewName (Split-Path -Leaf $CurrentLink)
      }
      Remove-ManagedLink $NextLink
      Start-Service -Name $ServiceName
      Restart-CdpHelper
      Wait-WorkerHealth ([string]$failedState.bootId) ([string]$oldState.agentVersion)
      if (-not $HeartbeatOnly) { Resume-DrainedTasks }
      $serviceStopped = $false
      throw "Upgrade failed and rollback completed; original error: $($upgradeError.Exception.Message)"
    } catch {
      if ($_.Exception.Message.StartsWith("Upgrade failed and rollback completed;")) { throw }
      throw "Upgrade failed and rollback recovery failed: $($_.Exception.Message); original error: $($upgradeError.Exception.Message)"
    }
  }
  if (-not $InstallOnly -and -not $HeartbeatOnly -and (Test-Path -LiteralPath $DrainJournal)) { Resume-DrainedTasks }
  throw
} finally {
  if (Test-Path -LiteralPath $manifestFile) { Remove-Item -LiteralPath $manifestFile -Force }
  if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force }
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  if ($releaseCreated -and -not $transactionCommitted -and -not (Test-Path -LiteralPath $PreviousLink)) {
    Remove-FailedRelease $ReleasePath
  }
}
