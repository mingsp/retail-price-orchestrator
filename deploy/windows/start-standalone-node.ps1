[CmdletBinding()]
param(
    [string]$ProjectRoot = 'C:\SpanAI\retail-radar-xcgjz',
    [string]$StateRoot = 'C:\ProgramData\RetailRadar\Standalone',
    [int]$DockerTimeoutSeconds = 300,
    [int]$ReadyTimeoutSeconds = 300,
    [switch]$EnableObservability
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$project = [IO.Path]::GetFullPath($ProjectRoot)
$state = [IO.Path]::GetFullPath($StateRoot)
$environmentPath = Join-Path $state 'config\.env.production'
$composePath = Join-Path $project 'infra\docker-compose.production.yml'
$certificatePath = Join-Path $state 'certificates\master-root.crt'
$logPath = Join-Path $state 'logs\standalone-start.log'
$dockerConfigPath = Join-Path $state 'docker-config'
$dockerPath = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$nodeVersionPath = Join-Path $project '.node-version'

foreach ($required in @($environmentPath, $composePath, $dockerPath, $nodeVersionPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required file is missing: $required" }
}

$requiredNodeVersion = (Get-Content -LiteralPath $nodeVersionPath -Raw).Trim()
if ($requiredNodeVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid pinned Node.js version: $requiredNodeVersion" }
$toolRoot = Join-Path $state "tools\node-v$requiredNodeVersion-win-x64"
$nodePath = Join-Path $toolRoot 'node.exe'
$corepackPath = Join-Path $toolRoot 'corepack.cmd'
foreach ($required in @($nodePath, $corepackPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Pinned runtime is missing: $required" }
}
$actualNodeVersion = (& $nodePath --version).Trim().TrimStart('v')
if ($LASTEXITCODE -ne 0 -or $actualNodeVersion -ne $requiredNodeVersion) {
    throw "Node.js version mismatch: expected $requiredNodeVersion, got $actualNodeVersion"
}
$env:PATH = "$toolRoot;$env:PATH"
$env:CI = 'true'

New-Item -ItemType Directory -Force -Path $dockerConfigPath | Out-Null
$dockerConfigFile = Join-Path $dockerConfigPath 'config.json'
if (-not (Test-Path -LiteralPath $dockerConfigFile -PathType Leaf)) {
    [IO.File]::WriteAllText($dockerConfigFile, '{}', [Text.UTF8Encoding]::new($false))
}
$env:DOCKER_CONFIG = $dockerConfigPath

function Write-Trace([string]$Message) {
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "$(Get-Date -Format o) $Message"
}

trap {
    Write-Trace ("error=" + $_.Exception.Message.Replace([Environment]::NewLine, ' '))
    exit 1
}

function Invoke-Docker {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $dockerPath --config $dockerConfigPath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -ne 0) { throw (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine) }
    return $output
}

Write-Trace 'start'
Write-Trace "runtime node=$actualNodeVersion observability=$($EnableObservability.IsPresent)"
$deadline = (Get-Date).AddSeconds($DockerTimeoutSeconds)
$engineVersion = $null
do {
    try {
        $engineVersion = (Invoke-Docker info --format '{{.ServerVersion}}' | Select-Object -First 1).ToString().Trim()
    } catch {
        $engineVersion = $null
        Start-Sleep -Seconds 5
    }
} while (-not $engineVersion -and (Get-Date) -lt $deadline)
if (-not $engineVersion) { throw 'Docker engine did not become ready before timeout' }
Write-Trace "docker_ready version=$engineVersion"

Push-Location $project
try {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $corepackPath pnpm deploy:validate *> $null
        $validationExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($validationExitCode -ne 0) { throw 'Production deployment validation failed' }
    $composeBase = @('compose', '--env-file', $environmentPath, '-f', $composePath)
    if ($EnableObservability) { $composeBase += @('--profile', 'observability') }
    Invoke-Docker @composeBase config --quiet | Out-Null
    Invoke-Docker @composeBase up --detach --build | ForEach-Object { Write-Trace $_.ToString() }
} finally {
    Pop-Location
}

$readyDeadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
$ready = $false
do {
    Start-Sleep -Seconds 5
    & curl.exe --silent --show-error --fail --insecure 'https://127.0.0.1:2808/ready' *> $null
    $ready = $LASTEXITCODE -eq 0
} while (-not $ready -and (Get-Date) -lt $readyDeadline)
if (-not $ready) { throw 'Master readiness endpoint did not become healthy before timeout' }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $certificatePath) | Out-Null
Push-Location $project
try {
    Invoke-Docker compose --env-file $environmentPath -f $composePath cp `
        'caddy:/data/caddy/pki/authorities/local/root.crt' $certificatePath | Out-Null
} finally {
    Pop-Location
}
Import-Certificate -FilePath $certificatePath -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null

$firewallName = 'RetailRadar Master 2808 LocalSubnet'
if (-not (Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow -Protocol TCP `
        -LocalPort 2808 -RemoteAddress LocalSubnet -Profile Private | Out-Null
}

Write-Trace 'ready'
[pscustomobject]@{
    status = 'ready'
    engineVersion = $engineVersion
    masterUrl = 'https://127.0.0.1:2808'
    nodeVersion = $actualNodeVersion
    observability = $EnableObservability.IsPresent
    environmentFile = $environmentPath
    certificate = $certificatePath
} | ConvertTo-Json -Compress
