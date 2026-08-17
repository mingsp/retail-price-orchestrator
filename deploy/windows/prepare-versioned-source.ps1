[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')][string]$Tag,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit,
    [string]$RepositoryUrl = 'https://github.com/mingsp/retail-price-orchestrator.git',
    [string]$InstallRoot = 'C:\ProgramData\RetailRadar\Master',
    [string]$OfflineCorepackHome = '',
    [string]$OfflinePnpmStore = ''
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

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    $previousPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 converts native stderr into ErrorRecord objects
        # when a caller redirects the script output. Exit code remains authoritative.
        $ErrorActionPreference = 'Continue'
        $output = @(& $Command @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousPreference }
    if ($exitCode -ne 0) {
        $details = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
        throw "$FailureMessage`n$details"
    }
    return $output
}

function Invoke-PinnedPnpm {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$RequiredVersion
    )

    $effectiveArguments = @($Arguments)
    if ($script:offlinePnpmStore -and $effectiveArguments.Count -gt 0 -and $effectiveArguments[0] -eq 'install') {
        $effectiveArguments += @('--offline', '--store-dir', $script:offlinePnpmStore)
    }
    if ($script:corepackCommand) {
        Invoke-NativeCommand -Command $script:corepackCommand -Arguments (@('pnpm') + $effectiveArguments) -FailureMessage "pnpm command failed: $($effectiveArguments -join ' ')"
    } else {
        $actualVersion = ((Invoke-NativeCommand -Command $script:pnpmCommand -Arguments @('--version') -FailureMessage 'pnpm version check failed') | Select-Object -Last 1).ToString().Trim()
        if ($actualVersion -ne $RequiredVersion) {
            throw "pnpm version mismatch: expected $RequiredVersion, got $actualVersion"
        }
        Invoke-NativeCommand -Command $script:pnpmCommand -Arguments $effectiveArguments -FailureMessage "pnpm command failed: $($effectiveArguments -join ' ')"
    }
}

$offlineRequested = -not [string]::IsNullOrWhiteSpace($OfflineCorepackHome) -or -not [string]::IsNullOrWhiteSpace($OfflinePnpmStore)
if ($offlineRequested) {
    if ([string]::IsNullOrWhiteSpace($OfflineCorepackHome) -or [string]::IsNullOrWhiteSpace($OfflinePnpmStore)) {
        throw 'OfflineCorepackHome and OfflinePnpmStore must be supplied together'
    }
    $offlineCorepack = [IO.Path]::GetFullPath($OfflineCorepackHome)
    $offlinePnpmStore = [IO.Path]::GetFullPath($OfflinePnpmStore)
    if (-not (Test-Path -LiteralPath $offlineCorepack -PathType Container)) { throw 'Offline Corepack cache was not found' }
    if (-not (Test-Path -LiteralPath $offlinePnpmStore -PathType Container)) { throw 'Offline pnpm store was not found' }
    $env:COREPACK_HOME = $offlineCorepack
    $env:COREPACK_ENABLE_NETWORK = '0'
    $script:offlinePnpmStore = $offlinePnpmStore
} else {
    $script:offlinePnpmStore = $null
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
    Invoke-NativeCommand -Command $gitCommand -Arguments @('clone', '--filter=blob:none', '--no-checkout', $RepositoryUrl, $staging) -FailureMessage 'Git clone failed'
    Invoke-NativeCommand -Command $gitCommand -Arguments @('-C', $staging, 'fetch', '--force', 'origin', "refs/tags/${Tag}:refs/tags/${Tag}") -FailureMessage "Tag fetch failed: $Tag"
    $actualCommit = ((Invoke-NativeCommand -Command $gitCommand -Arguments @('-C', $staging, 'rev-list', '-n', '1', $Tag) -FailureMessage 'Tag commit lookup failed') | Select-Object -Last 1).ToString().Trim().ToLowerInvariant()
    if ($actualCommit -ne $ExpectedCommit.ToLowerInvariant()) {
        throw "Tag commit mismatch: expected $ExpectedCommit, got $actualCommit"
    }
    Invoke-NativeCommand -Command $gitCommand -Arguments @('-C', $staging, 'checkout', '--detach', $Tag) -FailureMessage 'Detached checkout failed'
    Push-Location $staging
    try {
        $packageMetadata = Get-Content -LiteralPath (Join-Path $staging 'package.json') -Raw | ConvertFrom-Json
        $requiredNodeVersion = (Get-Content -LiteralPath (Join-Path $staging '.node-version') -Raw).Trim()
        $actualNodeVersion = ((Invoke-NativeCommand -Command $nodeCommand -Arguments @('--version') -FailureMessage 'Node.js version check failed') | Select-Object -Last 1).ToString().Trim().TrimStart('v')
        if ($actualNodeVersion -ne $requiredNodeVersion) {
            throw "Node.js version mismatch: expected $requiredNodeVersion, got $actualNodeVersion"
        }
        $requiredPnpmVersion = ([string]$packageMetadata.packageManager) -replace '^pnpm@', ''
        if (-not $requiredPnpmVersion) { throw 'packageManager must pin an exact pnpm version' }
        $actualPnpmVersion = if ($corepackCommand) {
            ((Invoke-NativeCommand -Command $corepackCommand -Arguments @('pnpm', '--version') -FailureMessage 'Corepack pnpm version check failed') | Select-Object -Last 1).ToString().Trim()
        } else {
            ((Invoke-NativeCommand -Command $pnpmCommand -Arguments @('--version') -FailureMessage 'pnpm version check failed') | Select-Object -Last 1).ToString().Trim()
        }
        if ($actualPnpmVersion -ne $requiredPnpmVersion) {
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
        offlineDependencyCache = $offlineRequested
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
