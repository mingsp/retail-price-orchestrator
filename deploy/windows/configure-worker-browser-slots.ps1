[CmdletBinding()]
param(
  [string]$InstallRoot = "$env:ProgramData\RetailRadar\Worker",
  [ValidateRange(1, 16)][int]$SlotCount = 5,
  [ValidateRange(1024, 65520)][int]$PortStart = 19661,
  [ValidatePattern('^[A-Za-z0-9._-]{1,48}$')][string]$ProfilePrefix = 'retail-radar',
  [ValidateRange(15, 180)][int]$HeartbeatTimeoutSeconds = 90,
  [switch]$AllowExistingManagedProfiles
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from an elevated PowerShell session'
}

$resolvedRoot = [IO.Path]::GetFullPath($InstallRoot)
$managedRoot = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'RetailRadar')).TrimEnd('\') + '\'
if (-not ($resolvedRoot.TrimEnd('\') + '\').StartsWith($managedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'InstallRoot must stay inside the managed RetailRadar ProgramData root'
}

$environmentFile = Join-Path $resolvedRoot 'config\worker.env'
$endpointFile = Join-Path $resolvedRoot 'config\cdp-endpoints.json'
$identityFile = Join-Path $resolvedRoot 'state\worker-identity.json'
$profileRoot = Join-Path $resolvedRoot 'state\chrome-profiles'
$backupRoot = Join-Path $resolvedRoot 'backups'
$serviceName = 'RetailRadarWorker'
$helperTaskName = 'RetailRadarCdpHelper'

foreach ($required in @($environmentFile, $identityFile)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "required_file_missing:$required" }
}
if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) { throw 'worker_service_missing' }
if (-not (Get-ScheduledTask -TaskName $helperTaskName -ErrorAction SilentlyContinue)) { throw 'cdp_helper_task_missing' }
if ($PortStart + $SlotCount - 1 -gt 65535) { throw 'requested_port_range_invalid' }

function Protect-File([string]$Path) {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $grants = @('*S-1-5-18:F', '*S-1-5-32-544:F')
  if ($sid -and $sid -notin @('S-1-5-18', 'S-1-5-32-544')) { $grants += "*$sid`:F" }
  $arguments = @($Path, '/inheritance:r', '/grant:r') + $grants
  & icacls.exe @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "acl_failed:$Path" }
}

function Read-Environment([string]$Path) {
  $result = [ordered]@{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if (-not $line -or $line.TrimStart().StartsWith('#')) { continue }
    $parts = $line.Split('=', 2)
    if ($parts.Count -eq 2) { $result[$parts[0].Trim()] = $parts[1] }
  }
  return $result
}

function Set-EnvironmentLine([Collections.Generic.List[string]]$Lines, [string]$Name, [string]$Value) {
  $prefix = "$Name="
  for ($index = 0; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index].StartsWith($prefix, [StringComparison]::Ordinal)) {
      $Lines[$index] = $prefix + $Value
      return
    }
  }
  [void]$Lines.Add($prefix + $Value)
}

function Get-OptionalProperty([object]$Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($property) { return $property.Value }
  return $null
}

function Invoke-MasterGet([string]$BaseUrl, [string]$CaPath, [string]$Path, [switch]$AsJson) {
  $responseFile = Join-Path $env:TEMP ('retail-radar-slot-' + [guid]::NewGuid().ToString('N') + '.out')
  try {
    $arguments = @('--silent', '--show-error', '--fail', '--ssl-no-revoke', '--noproxy', '*')
    if ($CaPath) { $arguments += @('--cacert', $CaPath) }
    $arguments += @('--output', $responseFile, ($BaseUrl.TrimEnd('/') + $Path))
    & curl.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "master_request_failed:$Path" }
    $text = [IO.File]::ReadAllText($responseFile, [Text.UTF8Encoding]::new($false))
    if ($AsJson) { return $text | ConvertFrom-Json }
    return $text
  } finally {
    if (Test-Path -LiteralPath $responseFile) { Remove-Item -LiteralPath $responseFile -Force }
  }
}

function Restart-WorkerRuntime {
  Restart-Service -Name 'RetailRadarWorker' -Force
  (Get-Service -Name $serviceName).WaitForStatus(
    [ServiceProcess.ServiceControllerStatus]::Running,
    [TimeSpan]::FromSeconds(30)
  )
  $task = Get-ScheduledTask -TaskName $helperTaskName -ErrorAction Stop
  if ($task.State -in @('Running', 'Queued')) {
    Stop-ScheduledTask -TaskName $helperTaskName
    $deadline = (Get-Date).AddSeconds(15)
    do {
      Start-Sleep -Milliseconds 500
      $task = Get-ScheduledTask -TaskName $helperTaskName -ErrorAction Stop
    } while ($task.State -in @('Running', 'Queued') -and (Get-Date) -lt $deadline)
    if ($task.State -in @('Running', 'Queued')) { throw 'cdp_helper_stop_timeout' }
  }
  Start-ScheduledTask -TaskName 'RetailRadarCdpHelper'
}

$workerIdentity = [IO.File]::ReadAllText($identityFile, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
$workerId = [string]$workerIdentity.workerId
$masterUrl = [string]$workerIdentity.masterBaseUrl
if (-not $workerId -or -not $masterUrl) { throw 'worker_identity_incomplete' }
$masterUri = [uri]$masterUrl
if (-not $masterUri.IsAbsoluteUri -or $masterUri.Scheme -ne 'https' -or $masterUri.UserInfo) {
  throw 'worker_master_url_invalid'
}
$caPath = Join-Path $resolvedRoot 'certificates\master-ca.crt'
if (-not (Test-Path -LiteralPath $caPath -PathType Leaf)) { $caPath = '' }
$workerEnvironment = Read-Environment $environmentFile
$runtimeStateFile = if ($workerEnvironment['WORKER_CDP_STATE_FILE']) {
  [IO.Path]::GetFullPath([string]$workerEnvironment['WORKER_CDP_STATE_FILE'])
} else {
  Join-Path $resolvedRoot 'state\cdp-runtime-state.json'
}
if (-not ($runtimeStateFile.TrimEnd('\') + '\').StartsWith(($resolvedRoot.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'runtime_state_outside_install_root'
}

$metrics = Invoke-MasterGet -BaseUrl $masterUrl -CaPath $caPath -Path '/metrics'
if ($metrics -notmatch '(?m)^retail_orchestrator_active_tasks 0$') {
  throw 'active_tasks_block_browser_slot_change'
}
$commands = Invoke-MasterGet -BaseUrl $masterUrl -CaPath $caPath -Path ("/api/cdp-commands?workerId=$([uri]::EscapeDataString($workerId))") -AsJson
if (@($commands.commands | Where-Object { $_.status -in @('pending', 'claimed', 'running') }).Count -gt 0) {
  throw 'active_cdp_commands_block_browser_slot_change'
}
$slotInventory = Invoke-MasterGet -BaseUrl $masterUrl -CaPath $caPath -Path ("/api/browser-slots?workerId=$([uri]::EscapeDataString($workerId))") -AsJson
$browserSlots = @($slotInventory.slots)

$ports = @($PortStart..($PortStart + $SlotCount - 1))
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains [int]$_.LocalPort })
if ($listeners.Count -gt 0 -and -not $AllowExistingManagedProfiles) {
  throw "requested_ports_in_use:$(@($listeners.LocalPort | Sort-Object -Unique) -join ',')"
}
foreach ($listener in $listeners) {
  $port = [int]$listener.LocalPort
  $position = $port - $PortStart + 1
  $expectedProfileId = ('{0}-{1:d2}' -f $ProfilePrefix, $position)
  $expectedProfilePath = Join-Path $profileRoot (Join-Path 'browser-profiles' $expectedProfileId)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$listener.OwningProcess)" -ErrorAction SilentlyContinue
  $commandLine = [string]$process.CommandLine
  if (
    -not $AllowExistingManagedProfiles -or
    -not $commandLine.Contains("--remote-debugging-port=$port") -or
    -not $commandLine.Contains($expectedProfilePath) -or
    -not $expectedProfilePath.Contains('chrome-profiles')
  ) {
    throw "existing_listener_not_managed:$port"
  }
}

$endpoints = @($ports | ForEach-Object {
  $port = [int]$_
  $position = $port - $PortStart + 1
  $matchingSlots = @($browserSlots | Where-Object { [int]$_.port -eq $port })
  if ($matchingSlots.Count -eq 0) { throw "browser_slot_missing:$port" }
  if ($matchingSlots.Count -gt 1) { throw "browser_slot_port_conflict:$port" }
  $slot = $matchingSlots | Select-Object -First 1
  $connectionEndpointId = "$workerId`:$port"
  [ordered]@{
    slotId = $slot.slotId
    endpointId = $connectionEndpointId
    workerId = $workerId
    host = '127.0.0.1'
    port = $port
    endpointUrl = "http://127.0.0.1:$port"
    status = 'idle'
    profileId = ('{0}-{1:d2}' -f $ProfilePrefix, $position)
  }
})

$backup = Join-Path $backupRoot ('browser-slot-prep-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $backup, $profileRoot | Out-Null
Copy-Item -LiteralPath $environmentFile -Destination (Join-Path $backup 'worker.env')
$hadEndpointFile = Test-Path -LiteralPath $endpointFile -PathType Leaf
if ($hadEndpointFile) { Copy-Item -LiteralPath $endpointFile -Destination (Join-Path $backup 'cdp-endpoints.json') }
$hadRuntimeState = Test-Path -LiteralPath $runtimeStateFile -PathType Leaf
if ($hadRuntimeState) { Copy-Item -LiteralPath $runtimeStateFile -Destination (Join-Path $backup 'runtime-state.json') }

$transactionCommitted = $false
try {
  $endpointTemporary = $endpointFile + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  [IO.File]::WriteAllText($endpointTemporary, ($endpoints | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $endpointTemporary -Destination $endpointFile -Force
  Protect-File $endpointFile

  if ($hadRuntimeState) {
    $runtimeState = [IO.File]::ReadAllText($runtimeStateFile, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    if (-not $runtimeState) { throw 'runtime_state_invalid' }
    $runtimeProperties = @($runtimeState.PSObject.Properties.Name)
    if ($runtimeProperties -notcontains 'endpoints' -or $runtimeProperties -notcontains 'accounts') {
      throw 'runtime_state_invalid'
    }
    $normalizedEndpoints = @($endpoints | ForEach-Object {
      $configured = $_
      $matches = @($runtimeState.endpoints | Where-Object { [int]$_.port -eq [int]$configured.port })
      $foreignProfiles = @($matches | Where-Object {
        $profileId = Get-OptionalProperty $_ 'profileId'
        $profileId -and $profileId -ne $configured.profileId
      })
      if ($foreignProfiles.Count -gt 0) { throw "stale_runtime_endpoint_port_conflict:$($configured.port)" }
      $observed = $matches | Select-Object -Last 1
      $runtimeStatus = Get-OptionalProperty $observed 'status'
      $observedStatus = if ($runtimeStatus -in @('manual_required', 'login_required', 'profile_risk', 'retired')) {
        [string]$runtimeStatus
      } else {
        [string]$configured.status
      }
      [ordered]@{
        slotId = $configured.slotId
        endpointId = $configured.endpointId
        workerId = $configured.workerId
        host = $configured.host
        port = $configured.port
        endpointUrl = $configured.endpointUrl
        wsEndpoint = Get-OptionalProperty $observed 'wsEndpoint'
        status = $observedStatus
        profileId = $configured.profileId
        accountId = Get-OptionalProperty $observed 'accountId'
        accountDisplayName = Get-OptionalProperty $observed 'accountDisplayName'
        maskedLogin = Get-OptionalProperty $observed 'maskedLogin'
        operatorOwner = Get-OptionalProperty $observed 'operatorOwner'
        targetStoreId = Get-OptionalProperty $observed 'targetStoreId'
        targetStoreName = Get-OptionalProperty $observed 'targetStoreName'
        currentCategoryName = Get-OptionalProperty $observed 'currentCategoryName'
        lastSeenUrl = Get-OptionalProperty $observed 'lastSeenUrl'
        lastSeenTitle = Get-OptionalProperty $observed 'lastSeenTitle'
        lastScreenshotArtifactId = Get-OptionalProperty $observed 'lastScreenshotArtifactId'
        manualNote = Get-OptionalProperty $observed 'manualNote'
      }
    })
    $runtimeState.endpoints = $normalizedEndpoints
    $runtimeState.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    $runtimeTemporary = $runtimeStateFile + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($runtimeTemporary, ($runtimeState | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $runtimeTemporary -Destination $runtimeStateFile -Force
    Protect-File $runtimeStateFile
  }

  $lines = [Collections.Generic.List[string]]::new()
  foreach ($line in [IO.File]::ReadAllLines($environmentFile)) { [void]$lines.Add($line) }
  Set-EnvironmentLine $lines 'WORKER_CDP_ENDPOINTS_JSON_FILE' $endpointFile
  Set-EnvironmentLine $lines 'WORKER_CAPTURE_CONCURRENCY' ([string]$SlotCount)
  Set-EnvironmentLine $lines 'WORKER_CAPTURE_QUEUE_MAX' ([string]$SlotCount)
  Set-EnvironmentLine $lines 'WORKER_MEMORY_SHRINK_RATIO' '0.96'
  Set-EnvironmentLine $lines 'WORKER_MEMORY_STOP_RATIO' '0.99'
  $environmentTemporary = $environmentFile + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  [IO.File]::WriteAllLines($environmentTemporary, $lines, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $environmentTemporary -Destination $environmentFile -Force
  Protect-File $environmentFile

  Restart-WorkerRuntime
  $deadline = (Get-Date).AddSeconds($HeartbeatTimeoutSeconds)
  do {
    Start-Sleep -Seconds 3
    $inventory = Invoke-MasterGet -BaseUrl $masterUrl -CaPath $caPath -Path ("/api/cdp-endpoints?workerId=$([uri]::EscapeDataString($workerId))") -AsJson
    $reported = @($inventory.cdpEndpoints | Where-Object { $ports -contains [int]$_.port })
  } while ($reported.Count -lt $SlotCount -and (Get-Date) -lt $deadline)
  if ($reported.Count -ne $SlotCount) { throw "cdp_endpoint_heartbeat_timeout:$($reported.Count)/$SlotCount" }
  $transactionCommitted = $true
} finally {
  if (-not $transactionCommitted) {
    Copy-Item -LiteralPath (Join-Path $backup 'worker.env') -Destination $environmentFile -Force
    if ($hadEndpointFile) {
      Copy-Item -LiteralPath (Join-Path $backup 'cdp-endpoints.json') -Destination $endpointFile -Force
    } elseif (Test-Path -LiteralPath $endpointFile) {
      Remove-Item -LiteralPath $endpointFile -Force
    }
    if ($hadRuntimeState) {
      Copy-Item -LiteralPath (Join-Path $backup 'runtime-state.json') -Destination $runtimeStateFile -Force
    }
    Protect-File $environmentFile
    if (Test-Path -LiteralPath $endpointFile) { Protect-File $endpointFile }
    if (Test-Path -LiteralPath $runtimeStateFile) { Protect-File $runtimeStateFile }
    Restart-WorkerRuntime
  }
}

[pscustomobject]@{
  success = $true
  workerId = $workerId
  slots = @($endpoints | ForEach-Object { [pscustomobject]@{ port = $_.port; profileId = $_.profileId; status = $_.status } })
  backup = $backup
  collectionStarted = $false
  storeNavigation = $false
} | ConvertTo-Json -Depth 5 -Compress
