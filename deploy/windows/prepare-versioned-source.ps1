[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')][string]$Tag,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit,
    [string]$RepositoryUrl = 'https://github.com/mingsp/retail-price-orchestrator.git',
    [string]$InstallRoot = 'C:\ProgramData\RetailRadar\Master'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-RequiredCommand {
    param([Parameter(Mandatory = $true)][string[]]$Names)

    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) { return $command.Source }
    }
    throw "Required command was not found: $($Names -join ', ')"
}

function Resolve-OptionalCommand {
    param([Parameter(Mandatory = $true)][string[]]$Names)

    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) { return $command.Source }
    }
    return $null
}

function Invoke-PinnedPnpm {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$RequiredVersion
    )

    if ($script:corepackCommand) {
        & $script:corepackCommand pnpm @Arguments
    }
    else {
        $actualVersion = (& $script:pnpmCommand --version).Trim()
        if ($LASTEXITCODE -ne 0 -or $actualVersion -ne $RequiredVersion) {
            throw "pnpm version mismatch: expected $RequiredVersion, got $actualVersion"
        }
        & $script:pnpmCommand @Arguments
    }
    if ($LASTEXITCODE -ne 0) { throw "pnpm command failed: $($Arguments -join ' ')" }
}

$gitCommand = Resolve-RequiredCommand -Names @('git.exe', 'git')
$nodeCommand = Resolve-RequiredCommand -Names @('node.exe', 'node')
$corepackCommand = Resolve-OptionalCommand -Names @('corepack.exe', 'corepack.cmd', 'corepack')
$pnpmCommand = Resolve-OptionalCommand -Names @('pnpm.exe', 'pnpm.cmd', 'pnpm')
if (-not $corepackCommand -and -not $pnpmCommand) {
    throw 'Required package manager was not found: Corepack or pnpm'
}

$sourcesRoot = Join-Path $InstallRoot 'sources'
$safeTag = $Tag -replace '[^A-Za-z0-9._-]', '_'
$destination = Join-Path $sourcesRoot $safeTag
$staging = Join-Path $sourcesRoot (".$safeTag.staging-" + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $destination) { throw "Versioned source already exists and will not be overwritten: $destination" }
New-Item -ItemType Directory -Force -Path $sourcesRoot | Out-Null

try {
    & $gitCommand clone --filter=blob:none --no-checkout $RepositoryUrl $staging
    if ($LASTEXITCODE -ne 0) { throw 'Git clone failed' }
    & $gitCommand -C $staging fetch --force origin "refs/tags/${Tag}:refs/tags/${Tag}"
    if ($LASTEXITCODE -ne 0) { throw "Tag fetch failed: $Tag" }
    $actualCommit = (& $gitCommand -C $staging rev-list -n 1 $Tag).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $ExpectedCommit.ToLowerInvariant()) {
        throw "Tag commit mismatch: expected $ExpectedCommit, got $actualCommit"
    }
    & $gitCommand -C $staging checkout --detach $Tag
    if ($LASTEXITCODE -ne 0) { throw 'Detached checkout failed' }
    Push-Location $staging
    try {
        $packageMetadata = Get-Content -LiteralPath (Join-Path $staging 'package.json') -Raw | ConvertFrom-Json
        $requiredNodeVersion = (Get-Content -LiteralPath (Join-Path $staging '.node-version') -Raw).Trim()
        $actualNodeVersion = (& $nodeCommand --version).Trim().TrimStart('v')
        if ($LASTEXITCODE -ne 0 -or $actualNodeVersion -ne $requiredNodeVersion) {
            throw "Node.js version mismatch: expected $requiredNodeVersion, got $actualNodeVersion"
        }
        $requiredPnpmVersion = ([string]$packageMetadata.packageManager) -replace '^pnpm@', ''
        if (-not $requiredPnpmVersion) { throw 'packageManager must pin an exact pnpm version' }
        $actualPnpmVersion = if ($corepackCommand) {
            (& $corepackCommand pnpm --version).Trim()
        } else {
            (& $pnpmCommand --version).Trim()
        }
        if ($LASTEXITCODE -ne 0 -or $actualPnpmVersion -ne $requiredPnpmVersion) {
            throw "pnpm version mismatch: expected $requiredPnpmVersion, got $actualPnpmVersion"
        }
        Invoke-PinnedPnpm -Arguments @('install', '--frozen-lockfile') -RequiredVersion $requiredPnpmVersion
        Invoke-PinnedPnpm -Arguments @('handoff:test') -RequiredVersion $requiredPnpmVersion
        Invoke-PinnedPnpm -Arguments @('typecheck') -RequiredVersion $requiredPnpmVersion
        Invoke-PinnedPnpm -Arguments @('public:verify') -RequiredVersion $requiredPnpmVersion
    }
    finally { Pop-Location }

    $manifest = [ordered]@{
        tag = $Tag
        commit = $actualCommit
        verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
        status = 'candidate_verified'
        activation = 'not_switched'
        previousDeploymentPreserved = $true
        nodeVersion = $actualNodeVersion
        pnpmVersion = $actualPnpmVersion
    }
    [IO.File]::WriteAllText(
        (Join-Path $staging 'candidate-verification.json'),
        ($manifest | ConvertTo-Json -Depth 5),
        [Text.UTF8Encoding]::new($false)
    )
    Move-Item -LiteralPath $staging -Destination $destination
    [pscustomobject]@{ status = 'pass'; destination = $destination; tag = $Tag; commit = $actualCommit; switched = $false } | ConvertTo-Json -Compress
}
catch {
    if (Test-Path -LiteralPath $staging) {
        $quarantine = Join-Path $sourcesRoot ("$safeTag.failed-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Move-Item -LiteralPath $staging -Destination $quarantine
    }
    throw
}
