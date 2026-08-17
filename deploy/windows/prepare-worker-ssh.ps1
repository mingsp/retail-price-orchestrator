[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$MasterPublicKeyPath,
  [ValidateRange(1, 65535)][int]$Port = 22
)

$ErrorActionPreference = "Stop"
$capabilityName = "OpenSSH.Server~~~~0.0.1.0"
$authorizedKeysPath = "C:\ProgramData\ssh\administrators_authorized_keys"
$firewallRuleName = "RetailRadar-OpenSSH-Server-In-TCP"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an elevated PowerShell session"
}

if (-not (Test-Path -LiteralPath $MasterPublicKeyPath -PathType Leaf)) {
  throw "Master public key file was not found"
}

$masterPublicKey = (Get-Content -Raw -LiteralPath $MasterPublicKeyPath -Encoding UTF8).Trim()
if ($masterPublicKey -notmatch "^ssh-ed25519\s+[A-Za-z0-9+/=]+(?:\s+[^\r\n]+)?$") {
  throw "Master public key must contain one valid Ed25519 public key"
}

$capability = Get-WindowsCapability -Online | Where-Object { $_.Name -eq $capabilityName } | Select-Object -First 1
if (-not $capability) { throw "OpenSSH Server capability is unavailable on this Windows installation" }
if ($capability.State -ne "Installed") {
  $installed = Add-WindowsCapability -Online -Name $capabilityName
  if ($installed.RestartNeeded) { throw "OpenSSH Server installation requires a Windows restart before continuing" }
}

$sshd = Get-Service -Name sshd -ErrorAction SilentlyContinue
if (-not $sshd) { throw "OpenSSH Server capability completed but the sshd service was not created" }

Set-Service -Name sshd -StartupType Automatic
if ($sshd.Status -eq "Running") {
  Restart-Service -Name sshd
} else {
  Start-Service -Name sshd
}

$authorizedKeysDirectory = Split-Path -Parent $authorizedKeysPath
New-Item -ItemType Directory -Force -Path $authorizedKeysDirectory | Out-Null
$existingKeys = if (Test-Path -LiteralPath $authorizedKeysPath) {
  @(Get-Content -LiteralPath $authorizedKeysPath -Encoding UTF8 | Where-Object { $_.Trim() })
} else {
  @()
}
if ($existingKeys -notcontains $masterPublicKey) {
  [IO.File]::WriteAllLines($authorizedKeysPath, @($existingKeys + $masterPublicKey), [Text.Encoding]::ASCII)
}

& icacls.exe $authorizedKeysPath /inheritance:r /grant:r "SYSTEM:F" "BUILTIN\Administrators:F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to secure the OpenSSH authorized keys file" }

if (-not (Get-NetFirewallRule -Name $firewallRuleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name $firewallRuleName -DisplayName "Retail Radar OpenSSH Server" `
    -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort $Port -Profile Private | Out-Null
}

Restart-Service -Name sshd
$adapter = Get-NetAdapter | Where-Object { $_.Status -eq "Up" } | Select-Object -First 1
$addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" } |
  Select-Object -ExpandProperty IPAddress)

[pscustomobject]@{
  HostName = $env:COMPUTERNAME
  UserName = (whoami)
  IPv4 = $addresses
  MacAddress = $adapter.MacAddress
  OpenSshCapability = (Get-WindowsCapability -Online | Where-Object { $_.Name -eq $capabilityName }).State
  SshdStatus = (Get-Service -Name sshd).Status.ToString()
  SshdStartup = (Get-CimInstance Win32_Service -Filter "Name='sshd'").StartMode
  Port = $Port
  AuthorizedKeyInstalled = $true
} | ConvertTo-Json -Compress
