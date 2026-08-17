[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://desktop\.docker\.com/')]
    [string]$InstallerUrl,

    [string]$InstallerPath = "$env:ProgramData\RetailRadar\bootstrap\DockerDesktopInstaller.exe"
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

& curl.exe -fL --retry 5 --retry-all-errors --connect-timeout 30 --insecure `
    --output $InstallerPath $InstallerUrl
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    throw 'Docker Desktop installer download failed'
}

$signature = Get-AuthenticodeSignature -FilePath $InstallerPath
if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
    throw "Docker Desktop Authenticode signature is invalid: $($signature.Status)"
}
if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch 'Docker') {
    throw "Docker Desktop signer is unexpected: $($signature.SignerCertificate.Subject)"
}

$hash = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
$process = Start-Process -FilePath $InstallerPath -Wait -PassThru -ArgumentList @(
    'install',
    '--quiet',
    '--accept-license',
    '--backend=wsl-2',
    '--no-windows-containers'
)
if ($process.ExitCode -notin @(0, 3010)) {
    throw "Docker Desktop installation failed with exit code $($process.ExitCode)"
}

$installed = Get-ItemProperty `
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', `
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' `
    -ErrorAction SilentlyContinue |
    Where-Object {
        ($_.PSObject.Properties.Name -contains 'DisplayName') -and
        $_.DisplayName -like 'Docker Desktop*'
    } |
    Select-Object -First 1

[pscustomobject]@{
    status = 'installed'
    version = $installed.DisplayVersion
    sha256 = $hash
    signer = $signature.SignerCertificate.Subject
    restartRequired = $process.ExitCode -eq 3010
} | ConvertTo-Json -Compress
