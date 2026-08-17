[CmdletBinding()]
param(
    [string]$ProjectRoot = 'C:\SpanAI\retail-radar-xcgjz',
    [string]$StateRoot = 'C:\ProgramData\RetailRadar\Standalone',
    [string]$MachineLabel = '66-worker-xcgjz',
    [ValidateSet('none', 'rustdesk', 'rdp')]
    [string]$RemoteDesktopProvider = 'none',
    [string]$RemoteDesktopTarget = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell session'
}

function Read-EnvironmentFile([string]$Path) {
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if (-not $line -or $line.StartsWith('#')) { continue }
        $separator = $line.IndexOf('=')
        if ($separator -lt 1) { continue }
        $values[$line.Substring(0, $separator)] = $line.Substring($separator + 1)
    }
    return $values
}

function Remove-SecretFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    $length = [Math]::Max(64, (Get-Item -LiteralPath $Path).Length)
    $random = New-Object byte[] $length
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($random) } finally { $generator.Dispose() }
    [IO.File]::WriteAllBytes($Path, $random)
    Remove-Item -LiteralPath $Path -Force
}

$project = [IO.Path]::GetFullPath($ProjectRoot)
$state = [IO.Path]::GetFullPath($StateRoot)
$environmentPath = Join-Path $state 'config\.env.production'
$certificatePath = Join-Path $state 'certificates\master-root.crt'
$manifestPath = Join-Path $project 'deploy\release\public\release-manifest.json'
$publicKeyPath = Join-Path $project 'deploy\release\public\worker-release-public.pem'
$winswPath = Join-Path $project 'deploy\release\public\tools\WinSW-x64-2.12.0.exe'
$installerPath = Join-Path $project 'deploy\windows\install-worker.ps1'

foreach ($required in @($environmentPath, $certificatePath, $manifestPath, $publicKeyPath, $winswPath, $installerPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required deployment file is missing: $required"
    }
}

$environment = Read-EnvironmentFile $environmentPath
foreach ($name in @('MASTER_PUBLIC_BASE_URL', 'RETAIL_RADAR_VERSION', 'OPERATOR_TOKEN')) {
    if (-not $environment.ContainsKey($name) -or -not $environment[$name]) {
        throw "Required private setting is missing: $name"
    }
}

$masterUrl = [string]$environment['MASTER_PUBLIC_BASE_URL']
$masterVersion = [string]$environment['RETAIL_RADAR_VERSION']
$operatorToken = [string]$environment['OPERATOR_TOKEN']
$manifest = Get-Content -Raw -LiteralPath $manifestPath -Encoding UTF8 | ConvertFrom-Json
$releaseKeyId = [string]$manifest.keyId
if (-not $releaseKeyId) { throw 'Release manifest does not contain keyId' }

$manifestUrl = "$($masterUrl.TrimEnd('/'))/releases/release-manifest.json"
$winswUrl = "$($masterUrl.TrimEnd('/'))/releases/tools/WinSW-x64-2.12.0.exe"
$winswSha256 = (Get-FileHash -LiteralPath $winswPath -Algorithm SHA256).Hash.ToLowerInvariant()
$secretRoot = Join-Path $env:ProgramData 'RetailRadar\secrets'
$tokenFile = Join-Path $secretRoot ("worker-enrollment-$([guid]::NewGuid().ToString('N')).token")
$enrollmentToken = $null

New-Item -ItemType Directory -Force -Path $secretRoot | Out-Null
& icacls.exe $secretRoot /inheritance:r /grant:r `
    'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' "${env:USERNAME}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the enrollment token directory' }

try {
    $health = Invoke-WebRequest -UseBasicParsing -Proxy $null -Uri "$($masterUrl.TrimEnd('/'))/ready" -TimeoutSec 20
    if ($health.StatusCode -ne 200) { throw 'Master readiness check failed' }

    $body = @{ label = $MachineLabel; expiresInMinutes = 30; maxUses = 1 } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Method Post `
        -Uri "$($masterUrl.TrimEnd('/'))/api/worker-enrollment-tokens" `
        -Headers @{ 'x-retail-operator-token' = $operatorToken } `
        -ContentType 'application/json' -Body $body -TimeoutSec 20
    $enrollmentToken = [string]$response.enrollment.enrollmentToken
    if (-not $enrollmentToken) { throw 'Master did not return an enrollment token' }

    [IO.File]::WriteAllText($tokenFile, $enrollmentToken, [Text.UTF8Encoding]::new($false))
    & icacls.exe $tokenFile /inheritance:r /grant:r `
        'SYSTEM:F' 'BUILTIN\Administrators:F' "${env:USERNAME}:F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the enrollment token file' }

    $machineLabelBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($MachineLabel))
    & $installerPath -MasterUrl $masterUrl -MasterVersion $masterVersion `
        -EnrollmentTokenFile $tokenFile -MachineLabel 'worker-bootstrap' `
        -MachineLabelBase64 $machineLabelBase64 -ManifestUrl $manifestUrl `
        -ReleasePublicKeyPath $publicKeyPath -ReleaseKeyId $releaseKeyId `
        -WinSWUrl $winswUrl -WinSWSha256 $winswSha256 `
        -MasterCaCertificatePath $certificatePath `
        -RemoteDesktopProvider $RemoteDesktopProvider -RemoteDesktopTarget $RemoteDesktopTarget
} finally {
    $operatorToken = $null
    $enrollmentToken = $null
    Remove-SecretFile $tokenFile
}
