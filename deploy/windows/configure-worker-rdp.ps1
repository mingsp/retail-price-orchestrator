[CmdletBinding()]
param(
  [string]$InstallRoot = "$env:ProgramData\RetailRadar\Worker",
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)\d{1,3}\.\d{1,3}$')]
  [string]$LanAddress,
  [ValidateRange(5, 60)][int]$ListenTimeoutSeconds = 20
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
$backupRoot = Join-Path $resolvedRoot ('backups\worker-rdp-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$terminalServerKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server'
$firewallRuleNames = @('RemoteDesktop-UserMode-In-TCP', 'RemoteDesktop-UserMode-In-UDP')
$serviceName = 'TermService'
$workerServiceName = 'RetailRadarWorker'

foreach ($required in @($environmentFile)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "required_file_missing:$required" }
}
if (-not (Get-Service -Name $workerServiceName -ErrorAction SilentlyContinue)) { throw 'worker_service_missing' }
if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) { throw 'rdp_service_missing' }

function Protect-File([string]$Path) {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $grants = @('*S-1-5-18:F', '*S-1-5-32-544:F')
  if ($sid -and $sid -notin @('S-1-5-18', 'S-1-5-32-544')) { $grants += "*$sid`:F" }
  & icacls.exe @($Path, '/inheritance:r', '/grant:r') @grants | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "acl_failed:$Path" }
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

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
Copy-Item -LiteralPath $environmentFile -Destination (Join-Path $backupRoot 'worker.env')
$previousDeny = [int](Get-ItemProperty -LiteralPath $terminalServerKey -Name fDenyTSConnections).fDenyTSConnections
$previousService = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
$previousServiceStatus = (Get-Service -Name $serviceName).Status
$firewallState = @($firewallRuleNames | ForEach-Object {
  $rule = Get-NetFirewallRule -Name $_ -ErrorAction SilentlyContinue
  if ($rule) {
    $addressFilter = $rule | Get-NetFirewallAddressFilter
    [pscustomobject]@{
      Name = $_
      Enabled = [string]$rule.Enabled
      RemoteAddress = @($addressFilter.RemoteAddress)
    }
  }
})
if (@($firewallState | Where-Object Name -eq 'RemoteDesktop-UserMode-In-TCP').Count -ne 1) {
  throw 'rdp_tcp_firewall_rule_missing'
}
$previousState = [ordered]@{
  denyConnections = $previousDeny
  serviceStartMode = [string]$previousService.StartMode
  serviceStatus = [string]$previousServiceStatus
  firewall = $firewallState
}
[IO.File]::WriteAllText(
  (Join-Path $backupRoot 'previous-state.json'),
  ($previousState | ConvertTo-Json -Depth 5),
  [Text.UTF8Encoding]::new($false)
)

function Restore-PreviousState {
  Copy-Item -LiteralPath (Join-Path $backupRoot 'worker.env') -Destination $environmentFile -Force
  Protect-File $environmentFile
  Set-ItemProperty -LiteralPath $terminalServerKey -Name fDenyTSConnections -Type DWord -Value $previousDeny
  foreach ($item in $firewallState) {
    Set-NetFirewallRule -Name $item.Name -Enabled $item.Enabled
    Get-NetFirewallRule -Name $item.Name |
      Get-NetFirewallAddressFilter |
      Set-NetFirewallAddressFilter -RemoteAddress $item.RemoteAddress
  }
  $startup = switch ($previousService.StartMode) {
    'Auto' { 'Automatic' }
    'Manual' { 'Manual' }
    'Disabled' { 'Disabled' }
    default { 'Manual' }
  }
  Set-Service -Name $serviceName -StartupType $startup
  if ($previousServiceStatus -eq [ServiceProcess.ServiceControllerStatus]::Running) {
    Start-Service -Name $serviceName
  } else {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  }
  Restart-Service -Name $workerServiceName -Force
}

try {
  Set-ItemProperty -LiteralPath $terminalServerKey -Name fDenyTSConnections -Type DWord -Value 0
  foreach ($item in $firewallState) {
    Set-NetFirewallRule -Name $item.Name -Enabled True
    Get-NetFirewallRule -Name $item.Name |
      Get-NetFirewallAddressFilter |
      Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
  }
  Set-Service -Name $serviceName -StartupType Automatic
  Start-Service -Name $serviceName

  $deadline = (Get-Date).AddSeconds($ListenTimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 500
    $listener = Get-NetTCPConnection -LocalPort 3389 -State Listen -ErrorAction SilentlyContinue
  } while (-not $listener -and (Get-Date) -lt $deadline)
  if (-not $listener) { throw 'rdp_listener_timeout' }

  $lines = [Collections.Generic.List[string]]::new()
  foreach ($line in [IO.File]::ReadAllLines($environmentFile)) { [void]$lines.Add($line) }
  Set-EnvironmentLine $lines 'WORKER_REMOTE_DESKTOP_PROVIDER' 'rdp'
  Set-EnvironmentLine $lines 'WORKER_REMOTE_DESKTOP_TARGET' $LanAddress
  $temporary = $environmentFile + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  [IO.File]::WriteAllLines($temporary, $lines, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $environmentFile -Force
  Protect-File $environmentFile
  Restart-Service -Name 'RetailRadarWorker' -Force
  (Get-Service -Name $workerServiceName).WaitForStatus(
    [ServiceProcess.ServiceControllerStatus]::Running,
    [TimeSpan]::FromSeconds(30)
  )
} catch {
  Restore-PreviousState
  throw
}

[pscustomobject]@{
  success = $true
  provider = 'rdp'
  target = $LanAddress
  port = 3389
  backup = $backupRoot
  workerRestarted = $true
} | ConvertTo-Json -Compress
