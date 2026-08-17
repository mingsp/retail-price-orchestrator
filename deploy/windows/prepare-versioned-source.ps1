[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')][string]$Tag,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit,
    [string]$RepositoryUrl = 'https://github.com/mingsp/retail-price-orchestrator.git',
    [string]$InstallRoot = 'C:\ProgramData\RetailRadar\Master'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourcesRoot = Join-Path $InstallRoot 'sources'
$safeTag = $Tag -replace '[^A-Za-z0-9._-]', '_'
$destination = Join-Path $sourcesRoot $safeTag
$staging = Join-Path $sourcesRoot (".$safeTag.staging-" + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $destination) { throw "Versioned source already exists and will not be overwritten: $destination" }
New-Item -ItemType Directory -Force -Path $sourcesRoot | Out-Null

try {
    & git.exe clone --filter=blob:none --no-checkout $RepositoryUrl $staging
    if ($LASTEXITCODE -ne 0) { throw 'Git clone failed' }
    & git.exe -C $staging fetch --force origin "refs/tags/${Tag}:refs/tags/${Tag}"
    if ($LASTEXITCODE -ne 0) { throw "Tag fetch failed: $Tag" }
    $actualCommit = (& git.exe -C $staging rev-list -n 1 $Tag).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $ExpectedCommit.ToLowerInvariant()) {
        throw "Tag commit mismatch: expected $ExpectedCommit, got $actualCommit"
    }
    & git.exe -C $staging checkout --detach $Tag
    if ($LASTEXITCODE -ne 0) { throw 'Detached checkout failed' }
    Push-Location $staging
    try {
        & corepack.exe enable
        if ($LASTEXITCODE -ne 0) { throw 'Corepack enable failed' }
        & corepack.exe pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Frozen dependency install failed' }
        & corepack.exe pnpm handoff:test
        if ($LASTEXITCODE -ne 0) { throw 'Handoff tests failed' }
        & corepack.exe pnpm typecheck
        if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }
        & corepack.exe pnpm public:verify
        if ($LASTEXITCODE -ne 0) { throw 'Public-source safety verification failed' }
    }
    finally { Pop-Location }

    $manifest = [ordered]@{
        tag = $Tag
        commit = $actualCommit
        verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
        status = 'candidate_verified'
        activation = 'not_switched'
        previousDeploymentPreserved = $true
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
