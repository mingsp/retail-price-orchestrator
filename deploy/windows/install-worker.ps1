[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$MasterUrl,
  [Parameter(Mandatory = $true)][string]$MasterVersion,
  [string]$EnrollmentToken = "",
  [string]$EnrollmentTokenFile = "",
  [Parameter(Mandatory = $true)][string]$MachineLabel,
  [ValidatePattern("^[A-Za-z0-9+/]+={0,2}$")][string]$MachineLabelBase64 = "",
  [Parameter(Mandatory = $true)][string]$ManifestUrl,
  [Parameter(Mandatory = $true)][string]$ReleasePublicKeyPath,
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9._-]{1,64}$")][string]$ReleaseKeyId,
  [Parameter(Mandatory = $true)][string]$WinSWUrl,
  [Parameter(Mandatory = $true)][ValidatePattern("^[a-fA-F0-9]{64}$")][string]$WinSWSha256,
  [string]$InstallRoot = "$env:ProgramData\RetailRadar\Worker",
  [string]$MasterCaCertificatePath,
  [ValidateSet("none", "rustdesk", "rdp")][string]$RemoteDesktopProvider = "none",
  [string]$RemoteDesktopTarget = "",
  [int]$HealthTimeoutSeconds = 180,
  [int]$StableHealthSeconds = 30,
  [switch]$HeartbeatOnly
)

$ErrorActionPreference = "Stop"
$ServiceName = "RetailRadarWorker"
$CdpHelperTaskName = "RetailRadarCdpHelper"
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$interactiveUser = $currentIdentity.Name
$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run this installer from an elevated PowerShell session" }

function Assert-HttpsUrl([string]$Value, [string]$Name) {
  $uri = [uri]$Value
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https" -or $uri.UserInfo) { throw "$Name must be an HTTPS URL without embedded credentials" }
}

function Write-InstallTrace([string]$Stage) {
  if (-not $installTraceFile) { return }
  $line = "$(Get-Date -Format o) $Stage"
  Add-Content -LiteralPath $installTraceFile -Value $line -Encoding UTF8
}

function Set-SecureDirectoryAcl([string]$Path) {
  & icacls.exe $Path /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "${env:USERNAME}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to secure directory ACL: $Path" }
}

function Set-SecureFileAcl([string]$Path) {
  & icacls.exe $Path /inheritance:r /grant:r "SYSTEM:F" "BUILTIN\Administrators:F" "${env:USERNAME}:F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to secure file ACL: $Path" }
}

function Remove-EnrollmentToken([string]$EnvironmentFile) {
  if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { return }
  $safe = Get-Content -LiteralPath $EnvironmentFile | Where-Object { -not $_.StartsWith("WORKER_ENROLLMENT_TOKEN=") }
  [IO.File]::WriteAllLines($EnvironmentFile, $safe, [Text.UTF8Encoding]::new($false))
  Set-SecureFileAcl $EnvironmentFile
}

function Read-And-Remove-EnrollmentTokenFile([string]$Path) {
  $resolved = [IO.Path]::GetFullPath($Path)
  $allowedRoot = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'RetailRadar')).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'EnrollmentTokenFile must be inside the managed RetailRadar ProgramData root'
  }
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw 'EnrollmentTokenFile was not found' }
  $value = (Get-Content -Raw -LiteralPath $resolved -Encoding UTF8).Trim()
  if (-not $value) { throw 'EnrollmentTokenFile is empty' }
  $buffer = New-Object byte[] ([Math]::Max(64, $value.Length))
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  [IO.File]::WriteAllBytes($resolved, $buffer)
  Remove-Item -LiteralPath $resolved -Force
  return $value
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

function Remove-CdpHelperTaskForCleanup {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & schtasks.exe /End /TN $CdpHelperTaskName 2>$null | Out-Null
    & schtasks.exe /Delete /TN $CdpHelperTaskName /F 2>$null | Out-Null
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Move-ReleaseToQuarantine([string]$ReleasePath) {
  if (-not $ReleasePath -or -not (Test-Path -LiteralPath $ReleasePath -PathType Container)) { return }
  $releaseRoot = [IO.Path]::GetFullPath((Join-Path $InstallRoot "releases")).TrimEnd('\') + '\'
  $resolvedRelease = [IO.Path]::GetFullPath($ReleasePath)
  if (-not $resolvedRelease.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to quarantine a release outside the managed release root"
  }
  $quarantineRoot = Join-Path $workRoot "quarantine"
  New-Item -ItemType Directory -Force -Path $quarantineRoot | Out-Null
  $name = Split-Path -Leaf $resolvedRelease
  $destination = Join-Path $quarantineRoot ("$name-failed-" + (Get-Date -Format "yyyyMMdd-HHmmss-fff"))
  Move-Item -LiteralPath $resolvedRelease -Destination $destination -ErrorAction Stop
}

function Read-InstalledWorkerIdentity([string]$Path, [switch]$AllowMissing) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    if ($AllowMissing) { return $null }
    throw "Worker identity file is missing: $Path"
  }
  try { $identity = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json } catch { throw "Worker identity file is invalid: $Path" }
  if (-not [string]$identity.workerId -or -not [string]$identity.workerToken -or -not [string]$identity.masterBaseUrl) {
    throw "Worker identity file is incomplete: $Path"
  }
  if ([string]$identity.masterBaseUrl.TrimEnd('/') -ne $MasterUrl.TrimEnd('/')) {
    throw "Existing Worker identity belongs to a different Master"
  }
  return $identity
}

function Wait-WorkerStable([string]$ExpectedWorkerId, [string]$ExpectedVersion, [string]$WorkerToken) {
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
  $stableSince = $null
  $lastHealthDetail = "no response received"
  do {
    try {
      $response = Invoke-RestMethod -Method Get -Uri "$($MasterUrl.TrimEnd('/'))/api/worker/self" `
        -Headers @{ Authorization = "Bearer $WorkerToken" } -TimeoutSec 10
      $worker = $response.worker.worker
      if ($worker.status -eq "online" -and $worker.agentVersion -eq $ExpectedVersion -and $worker.bootId) {
        $lastHealthDetail = "online version=$($worker.agentVersion) bootId=present"
        if (-not $stableSince) { $stableSince = Get-Date }
        if (((Get-Date) - $stableSince).TotalSeconds -ge $StableHealthSeconds) { return }
      } else {
        $lastHealthDetail = "status=$($worker.status) version=$($worker.agentVersion) bootId=$([bool]$worker.bootId)"
        $stableSince = $null
      }
    } catch {
      $lastHealthDetail = $_.Exception.Message
      $stableSince = $null
    }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)
  throw "Worker did not remain online at version $ExpectedVersion for $StableHealthSeconds seconds; last check: $lastHealthDetail"
}

function Remove-WorkerServiceForCleanup {
  $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  if (-not $service) { return }

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
    if ($LASTEXITCODE -ne 0) { throw "Failed to terminate the Worker service process during cleanup" }
  }

  try {
    $ErrorActionPreference = "Continue"
    & sc.exe delete $ServiceName 2>$null | Out-Null
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
    $remaining = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  } while ($remaining -and (Get-Date) -lt $deadline)
  if ($remaining) { throw "Worker service removal did not complete during cleanup" }
}

function Restart-WorkerServiceAfterEnrollment {
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
    if ($LASTEXITCODE -ne 0) { throw "Failed to terminate the Worker service process after enrollment" }
  }
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
    $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  } while ($service -and $service.State -ne "Stopped" -and (Get-Date) -lt $deadline)
  if (-not $service -or $service.State -ne "Stopped") { throw "Worker service did not stop after enrollment" }
  Start-Service -Name $ServiceName
  (Get-Service -Name $ServiceName).WaitForStatus(
    [ServiceProcess.ServiceControllerStatus]::Running,
    [TimeSpan]::FromSeconds(30)
  )
}

Assert-HttpsUrl $MasterUrl "MasterUrl"
Assert-HttpsUrl $ManifestUrl "ManifestUrl"
Assert-HttpsUrl $WinSWUrl "WinSWUrl"
if (-not (Test-Path -LiteralPath $ReleasePublicKeyPath -PathType Leaf)) { throw "Release public key was not found" }
if ($EnrollmentToken -and $EnrollmentTokenFile) { throw 'Use EnrollmentToken or EnrollmentTokenFile, not both' }
if (-not $EnrollmentToken -and $EnrollmentTokenFile) { $EnrollmentToken = Read-And-Remove-EnrollmentTokenFile $EnrollmentTokenFile }

$node = Get-Command node -ErrorAction Stop
$nodeMajor = [int]((& $node.Source --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required" }
$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $chrome) { throw "Google Chrome was not found" }

$serviceRoot = Join-Path $InstallRoot "service"
$configRoot = Join-Path $InstallRoot "config"
$stateRoot = Join-Path $InstallRoot "state"
$dataRoot = Join-Path $InstallRoot "data"
$certificateRoot = Join-Path $InstallRoot "certificates"
$workRoot = Join-Path $InstallRoot "work"
$installTraceFile = Join-Path $workRoot "install-trace.log"
$environmentFile = Join-Path $configRoot "worker.env"
$identityFile = Join-Path $stateRoot "worker-identity.json"
$installMarker = Join-Path $InstallRoot ".installing"
$winswPath = Join-Path $serviceRoot "RetailRadarWorker.exe"
$winswDownload = Join-Path $workRoot "RetailRadarWorker.download"

if ((Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath $installMarker)) {
  throw "Worker is already installed; use the upgrade script instead"
}

if (Test-Path -LiteralPath $installMarker) {
  Write-InstallTrace "interrupted_cleanup:start"
  Write-Warning "Cleaning an interrupted installation before retry"
  Write-InstallTrace "interrupted_cleanup:helper_task:start"
  Remove-CdpHelperTaskForCleanup
  Write-InstallTrace "interrupted_cleanup:helper_task:done"
  $staleService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($staleService) {
    Write-InstallTrace "interrupted_cleanup:service:start"
    Remove-WorkerServiceForCleanup
    Write-InstallTrace "interrupted_cleanup:service:done"
  }
  Remove-EnrollmentToken $environmentFile
  $staleRelease = $null
  $staleCurrent = Join-Path $InstallRoot "current"
  Write-InstallTrace "interrupted_cleanup:current_target:start"
  if (Test-Path -LiteralPath $staleCurrent) { $staleRelease = (Get-Item -LiteralPath $staleCurrent -Force).Target }
  Write-InstallTrace "interrupted_cleanup:current_target:done"
  Write-InstallTrace "interrupted_cleanup:links:start"
  foreach ($link in @((Join-Path $InstallRoot "current.next"), (Join-Path $InstallRoot "current.previous"), $staleCurrent)) {
    if (Test-Path -LiteralPath $link) { Remove-ManagedLink $link }
  }
  Write-InstallTrace "interrupted_cleanup:links:done"
  Write-InstallTrace "interrupted_cleanup:quarantine:start"
  Move-ReleaseToQuarantine ([string]$staleRelease)
  Write-InstallTrace "interrupted_cleanup:quarantine:done"
  Remove-Item -LiteralPath $winswDownload, $winswPath, $installMarker -Force -ErrorAction SilentlyContinue
  Write-InstallTrace "interrupted_cleanup:done"
}

$persistedIdentity = Read-InstalledWorkerIdentity $identityFile -AllowMissing
if (-not $persistedIdentity -and -not $EnrollmentToken) {
  throw "EnrollmentToken is required when no Master-issued Worker identity exists"
}
if ($persistedIdentity) {
  Write-Host "Resuming installation with preserved Master-issued Worker identity $($persistedIdentity.workerId)"
}

New-Item -ItemType Directory -Force -Path $InstallRoot, $serviceRoot, $configRoot, $stateRoot, $dataRoot, $certificateRoot, $workRoot | Out-Null
Set-SecureDirectoryAcl $configRoot
Set-SecureDirectoryAcl $stateRoot
$writeProbe = Join-Path $InstallRoot ".write-test-$([guid]::NewGuid().ToString('N'))"
Set-Content -LiteralPath $writeProbe -Value "ok" -NoNewline
Remove-Item -LiteralPath $writeProbe -Force
[IO.File]::WriteAllText($installMarker, (Get-Date).ToString("O"), [Text.UTF8Encoding]::new($false))

$nodeExtraCa = ""
$releasePublicKey = Join-Path $certificateRoot "release-signing-public.pem"
$serviceInstalled = $false
$releasePath = $null
try {
  Write-InstallTrace "install:start"
  Copy-Item -LiteralPath $ReleasePublicKeyPath -Destination $releasePublicKey -Force
  Set-SecureFileAcl $releasePublicKey
  if ($MasterCaCertificatePath) {
    if (-not (Test-Path -LiteralPath $MasterCaCertificatePath -PathType Leaf)) { throw "Master CA certificate was not found" }
    $nodeExtraCa = Join-Path $certificateRoot "master-ca.crt"
    Copy-Item -LiteralPath $MasterCaCertificatePath -Destination $nodeExtraCa -Force
    Set-SecureFileAcl $nodeExtraCa
    Import-Certificate -FilePath $nodeExtraCa -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null
    $env:NODE_EXTRA_CA_CERTS = $nodeExtraCa
  }

  $health = Invoke-WebRequest -UseBasicParsing -Proxy $null -Uri "$($MasterUrl.TrimEnd('/'))/health" -TimeoutSec 20
  if ($health.StatusCode -ne 200) { throw "Master HTTPS health check failed" }

  Invoke-WebRequest -UseBasicParsing -Proxy $null -Uri $WinSWUrl -OutFile $winswDownload -TimeoutSec 180
  $actualWinSWHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $winswDownload).Hash.ToLowerInvariant()
  if ($actualWinSWHash -ne $WinSWSha256.ToLowerInvariant()) { throw "WinSW SHA256 verification failed" }

  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "start-worker.ps1") -Destination (Join-Path $serviceRoot "start-worker.ps1") -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "start-cdp-helper.ps1") -Destination (Join-Path $serviceRoot "start-cdp-helper.ps1") -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "upgrade-worker.ps1") -Destination (Join-Path $serviceRoot "upgrade-worker.ps1") -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "retail-worker-service.xml") -Destination (Join-Path $serviceRoot "RetailRadarWorker.xml") -Force
  Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) "release\verify-release-manifest.mjs") `
    -Destination (Join-Path $serviceRoot "verify-release-manifest.mjs") -Force
  Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) "release\release-manifest-lib.mjs") `
    -Destination (Join-Path $serviceRoot "release-manifest-lib.mjs") -Force

  if ($MachineLabelBase64) {
    try {
      $decodedMachineLabel = [Text.UTF8Encoding]::new($false, $true).GetString([Convert]::FromBase64String($MachineLabelBase64)).Trim()
    } catch {
      throw "MachineLabelBase64 must contain valid UTF-8"
    }
    if (-not $decodedMachineLabel) { throw "MachineLabelBase64 decoded to an empty label" }
    $machineLabelBase64 = $MachineLabelBase64
  } else {
    $machineLabelBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($MachineLabel))
  }
  $environmentLines = @(
    "MASTER_BASE_URL=$($MasterUrl.TrimEnd('/'))",
    "WORKER_MACHINE_LABEL=$MachineLabel",
    "WORKER_MACHINE_LABEL_BASE64=$machineLabelBase64",
    "WORKER_IDENTITY_FILE=$identityFile",
    "WORKER_CHROME_EXECUTABLE=$chrome",
    "WORKER_CHROME_PROFILE_ROOT=$(Join-Path $stateRoot 'chrome-profiles')",
    "WORKER_CDP_STATE_FILE=$(Join-Path $stateRoot 'cdp-runtime-state.json')",
    "WORKER_NATIVE_OUTPUT_ROOT=$(Join-Path $dataRoot 'native-capture')",
    "WORKER_MUTATION_SPOOL_FILE=$(Join-Path $dataRoot 'spool\master-mutations.jsonl')",
    "WORKER_ENABLE_TASK_POLLING=$((-not $HeartbeatOnly).ToString().ToLowerInvariant())",
    "WORKER_ENABLE_TASK_EXECUTION=$((-not $HeartbeatOnly).ToString().ToLowerInvariant())",
    "WORKER_ENABLE_CDP_COMMANDS=false",
    "WORKER_COLLECTOR_ADAPTER=native",
    "WORKER_NATIVE_SCRIPT_ROOT=scripts",
    "WORKER_REMOTE_DESKTOP_PROVIDER=$RemoteDesktopProvider",
    "WORKER_REMOTE_DESKTOP_TARGET=$RemoteDesktopTarget"
  )
  if ($HeartbeatOnly) {
    $environmentLines += "WORKER_ACCOUNTS_JSON=[]"
    $environmentLines += "WORKER_CDP_ENDPOINTS_JSON=[]"
  }
  if (-not $persistedIdentity) { $environmentLines += "WORKER_ENROLLMENT_TOKEN=$EnrollmentToken" }
  if ($nodeExtraCa) { $environmentLines += "NODE_EXTRA_CA_CERTS=$nodeExtraCa" }
  [IO.File]::WriteAllLines($environmentFile, $environmentLines, [Text.UTF8Encoding]::new($false))
  Set-SecureFileAcl $environmentFile

  & (Join-Path $serviceRoot "upgrade-worker.ps1") -ManifestUrl $ManifestUrl -MasterUrl $MasterUrl `
    -CurrentMasterVersion $MasterVersion -ReleasePublicKeyPath $releasePublicKey -ReleaseKeyId $ReleaseKeyId `
    -InstallRoot $InstallRoot -InstallOnly
  $releasePackage = Get-Content -Raw -LiteralPath (Join-Path $InstallRoot "current\package.json") | ConvertFrom-Json
  $expectedVersion = [string]$releasePackage.version
  $releasePath = (Get-Item -LiteralPath (Join-Path $InstallRoot "current") -Force).Target
  Write-InstallTrace "install:release_ready"

  Move-Item -LiteralPath $winswDownload -Destination $winswPath
  Push-Location $serviceRoot
  try {
    & $winswPath install
    $serviceInstalled = $true
    & $winswPath start
  } finally { Pop-Location }

  $deadline = (Get-Date).AddMinutes(2)
  while (-not (Test-Path -LiteralPath $identityFile -PathType Leaf) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  if (-not (Test-Path -LiteralPath $identityFile -PathType Leaf)) { throw "Worker service started but enrollment did not create an identity file" }
  $installedIdentity = Read-InstalledWorkerIdentity $identityFile
  $effectiveWorkerId = [string]$installedIdentity.workerId
  Set-SecureFileAcl $identityFile
  Remove-EnrollmentToken $environmentFile
  if (-not $persistedIdentity) { Restart-WorkerServiceAfterEnrollment }
  Write-InstallTrace "install:health_wait:start"
  Wait-WorkerStable $effectiveWorkerId $expectedVersion ([string]$installedIdentity.workerToken)
  Write-InstallTrace "install:health_wait:done"
  if (-not $HeartbeatOnly) {
    $helperScript = Join-Path $serviceRoot "start-cdp-helper.ps1"
    $helperAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$helperScript`""
    $helperTrigger = New-ScheduledTaskTrigger -AtLogOn -User $interactiveUser
    $helperPrincipal = New-ScheduledTaskPrincipal -UserId $interactiveUser -LogonType Interactive -RunLevel Highest
    $helperSettings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $CdpHelperTaskName -Action $helperAction -Trigger $helperTrigger -Principal $helperPrincipal -Settings $helperSettings -Force | Out-Null
    Start-ScheduledTask -TaskName $CdpHelperTaskName
  }
  Remove-Item -LiteralPath $installMarker -Force
  Write-InstallTrace "install:done"
  Write-Host "Worker installed transactionally. Service=$ServiceName WorkerId=$effectiveWorkerId Version=$expectedVersion"
} catch {
  $installError = $_
  Write-InstallTrace "rollback:start error=$($installError.Exception.Message)"
  try {
    Write-InstallTrace "rollback:helper_task:start"
    Remove-CdpHelperTaskForCleanup
    Write-InstallTrace "rollback:helper_task:done"
    if ($serviceInstalled) { Remove-WorkerServiceForCleanup }
    Write-InstallTrace "rollback:service:done"
    Remove-EnrollmentToken $environmentFile
    $currentLink = Join-Path $InstallRoot "current"
    if (-not $releasePath -and (Test-Path -LiteralPath $currentLink)) { $releasePath = (Get-Item -LiteralPath $currentLink -Force).Target }
    foreach ($link in @((Join-Path $InstallRoot "current.next"), (Join-Path $InstallRoot "current.previous"), $currentLink)) {
      if (Test-Path -LiteralPath $link) { Remove-ManagedLink $link }
    }
    Move-ReleaseToQuarantine ([string]$releasePath)
    Write-InstallTrace "rollback:release:done"
    Remove-Item -LiteralPath $winswDownload, $winswPath -Force -ErrorAction SilentlyContinue
  } finally {
    Remove-Item -LiteralPath $installMarker -Force -ErrorAction SilentlyContinue
    Write-InstallTrace "rollback:done"
  }
  throw "Worker installation rolled back and can be retried: $($installError.Exception.Message)"
}
