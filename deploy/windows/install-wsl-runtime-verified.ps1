[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://github\.com/microsoft/WSL/releases/download/')]
    [string]$InstallerUrl,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$ExpectedSha256,

    [string]$InstallerPath = "$env:ProgramData\RetailRadar\bootstrap\wsl-runtime-x64.msi"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell session'
}

$installerDirectory = Split-Path -Parent $InstallerPath
New-Item -ItemType Directory -Force -Path $installerDirectory | Out-Null

$currentHash = if (Test-Path -LiteralPath $InstallerPath -PathType Leaf) {
    (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
} else {
    $null
}

if ($currentHash -ne $ExpectedSha256.ToLowerInvariant()) {
    & curl.exe -fL --retry 5 --retry-all-errors --connect-timeout 30 --insecure `
        --output $InstallerPath $InstallerUrl
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
        throw 'WSL runtime installer download failed'
    }
}

$hash = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $ExpectedSha256.ToLowerInvariant()) {
    throw "WSL runtime SHA256 mismatch: $hash"
}

$signature = Get-AuthenticodeSignature -FilePath $InstallerPath
if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
    throw "WSL runtime Authenticode signature is invalid: $($signature.Status)"
}
if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') {
    throw "WSL runtime signer is unexpected: $($signature.SignerCertificate.Subject)"
}

$logPath = Join-Path $installerDirectory 'wsl-runtime-install.log'
$process = Start-Process -FilePath msiexec.exe -Wait -PassThru -ArgumentList @(
    '/i',
    $InstallerPath,
    '/qn',
    '/norestart',
    '/l*v',
    $logPath
)
if ($process.ExitCode -notin @(0, 3010)) {
    throw "WSL runtime installation failed with exit code $($process.ExitCode); log: $logPath"
}

[pscustomobject]@{
    status = 'installed'
    sha256 = $hash
    signer = $signature.SignerCertificate.Subject
    restartRequired = $process.ExitCode -eq 3010
    rebootInvoked = $false
    logPath = $logPath
} | ConvertTo-Json -Compress
