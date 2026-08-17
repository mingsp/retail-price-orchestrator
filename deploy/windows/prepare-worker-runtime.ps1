[CmdletBinding()]
param(
  [ValidatePattern('^\d+\.\d+\.\d+$')][string]$NodeVersion = '22.19.0',
  [string]$PackageRoot = "$env:ProgramData\RetailRadar\bootstrap\packages",
  [string]$NodeMsiUrl = '',
  [string]$ChromeMsiUrl = 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from an elevated PowerShell session'
}

function Invoke-VerifiedDownload([string]$Uri, [string]$Destination, [string]$ProductName) {
  $parsed = [uri]$Uri
  if (-not $parsed.IsAbsoluteUri -or $parsed.Scheme -ne 'https' -or $parsed.UserInfo) {
    throw "$ProductName download URL must be HTTPS without embedded credentials"
  }

  & curl.exe -fL --silent --show-error -o $Destination $Uri
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
    throw "$ProductName download failed"
  }

  $signature = Get-AuthenticodeSignature -FilePath $Destination
  if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
    throw "$ProductName Authenticode signature is not valid: $($signature.Status)"
  }

  return [pscustomobject]@{
    path = $Destination
    sha256 = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
    signer = $signature.SignerCertificate.Subject
    sizeBytes = (Get-Item -LiteralPath $Destination).Length
  }
}

function Invoke-MsiInstall([string]$MsiPath, [string]$ProductName) {
  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $MsiPath, '/qn', '/norestart') -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "$ProductName MSI installation failed with exit code $($process.ExitCode)"
  }
  return $process.ExitCode
}

function Resolve-ChromePath {
  return @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
}

New-Item -ItemType Directory -Force -Path $PackageRoot | Out-Null
& icacls.exe $PackageRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' "${env:USERNAME}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the runtime package directory' }

if (-not $NodeMsiUrl) {
  $NodeMsiUrl = "https://nodejs.org/download/release/v$NodeVersion/node-v$NodeVersion-x64.msi"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeInstalled = $false
$nodePackage = $null
if (-not $nodeCommand -or [int]((& $nodeCommand.Source --version).TrimStart('v').Split('.')[0]) -lt 22) {
  $nodeMsi = Join-Path $PackageRoot "node-v$NodeVersion-x64.msi"
  $nodePackage = Invoke-VerifiedDownload $NodeMsiUrl $nodeMsi 'Node.js'
  Invoke-MsiInstall $nodeMsi 'Node.js' | Out-Null
  $nodeInstalled = $true
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

$chromePath = Resolve-ChromePath
$chromeInstalled = $false
$chromePackage = $null
if (-not $chromePath) {
  $chromeMsi = Join-Path $PackageRoot 'GoogleChromeStandaloneEnterprise64.msi'
  $chromePackage = Invoke-VerifiedDownload $ChromeMsiUrl $chromeMsi 'Google Chrome'
  Invoke-MsiInstall $chromeMsi 'Google Chrome' | Out-Null
  $chromeInstalled = $true
  $chromePath = Resolve-ChromePath
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js was installed but node is not available on PATH' }
if (-not $chromePath) { throw 'Google Chrome was installed but chrome.exe was not found' }

[pscustomobject]@{
  nodeVersion = (& $nodeCommand.Source --version)
  nodeInstalled = $nodeInstalled
  nodePackage = $nodePackage
  chromeVersion = (Get-Item -LiteralPath $chromePath).VersionInfo.ProductVersion
  chromeInstalled = $chromeInstalled
  chromePath = $chromePath
  chromePackage = $chromePackage
  rebootRequired = $false
} | ConvertTo-Json -Depth 6 -Compress
