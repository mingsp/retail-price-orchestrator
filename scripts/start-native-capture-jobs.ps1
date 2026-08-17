[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath
)

$ErrorActionPreference = "Stop"

function Resolve-RepoPath {
    param([string]$Value, [string]$RepoRoot)
    if ([System.IO.Path]::IsPathRooted($Value)) {
        return [System.IO.Path]::GetFullPath($Value)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Value))
}

function Test-CdpTarget {
    param([string]$Endpoint, [string]$TargetUrlPart)

    Invoke-RestMethod -Uri "$Endpoint/json/version" -TimeoutSec 5 | Out-Null
    $pages = @(Invoke-RestMethod -Uri "$Endpoint/json/list" -TimeoutSec 5)
    if (-not ($pages | Where-Object { $_.type -eq "page" -and $_.url -like "*$TargetUrlPart*" })) {
        throw "CDP $Endpoint does not have the required target store page: $TargetUrlPart"
    }
}

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Capture job config is missing: $ConfigPath"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$node = (Get-Command node -ErrorAction Stop).Source
$captureScript = Resolve-RepoPath -Value $config.script -RepoRoot $repoRoot
$outputRoot = Resolve-RepoPath -Value $config.outputRoot -RepoRoot $repoRoot
$pidRoot = Join-Path $outputRoot "pids"
$logRoot = Join-Path $outputRoot "logs"
[void](New-Item -ItemType Directory -Force -Path $pidRoot, $logRoot)

$results = @()
foreach ($job in @($config.jobs | Where-Object { $_.enabled -eq $true })) {
    Test-CdpTarget -Endpoint $job.cdpEndpoint -TargetUrlPart $job.targetUrlPart

    $pidFile = Join-Path $pidRoot "$($job.jobId).json"
    if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
        $existing = Get-Content -LiteralPath $pidFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $existingProcess = Get-Process -Id $existing.pid -ErrorAction SilentlyContinue
        if ($existingProcess) {
            $results += [pscustomobject]@{
                jobId = $job.jobId
                pid = $existing.pid
                status = "already_running"
                outputDir = $existing.outputDir
            }
            continue
        }
    }

    $outputDir = Join-Path $outputRoot $job.jobId
    [void](New-Item -ItemType Directory -Force -Path $outputDir)
    $captureId = "$($config.runId)-$($job.jobId)"
    $stdout = Join-Path $logRoot "$($job.jobId).stdout.log"
    $stderr = Join-Path $logRoot "$($job.jobId).stderr.log"

    $environment = @{
        MT_CDP_ENDPOINT = [string]$job.cdpEndpoint
        MT_CDP_PORT = [string]$job.cdpPort
        MT_TARGET_URL_PART = [string]$job.targetUrlPart
        MT_RUN_ID = [string]$config.runId
        MT_CAPTURE_ID = $captureId
        MT_OUTPUT_DIR = $outputDir
        MT_WORKER_ID = [string]$job.workerId
        MT_TASK_ID = [string]$job.jobId
        MT_STORE_ID = [string]$job.storeId
        MT_STORE_NAME = [string]$job.storeName
        MT_ACCOUNT_ID = [string]$job.accountId
        MT_ACCOUNT_LABEL = [string]$job.accountLabel
        MT_PROFILE_ID = [string]$job.profileId
        MT_CAPTURE_ALL_CATEGORIES = if ($null -ne $job.captureAllCategories) {
            ([bool]$job.captureAllCategories).ToString().ToLowerInvariant()
        } elseif ($job.categoryTag -or $job.categoryTags -or $job.categoryNames) {
            "false"
        } else {
            "true"
        }
        MT_CATEGORY_TAG = [string]$job.categoryTag
        MT_CATEGORY_TAGS = [string](@($job.categoryTags) -join ",")
        MT_CATEGORY_NAMES = [string](@($job.categoryNames) -join ",")
        MT_CATEGORY_I = [string]$job.categoryI
        MT_CATEGORY_J = [string]$job.categoryJ
        MT_START_CATEGORY_I = [string]$job.startCategoryI
        MT_END_CATEGORY_I = [string]$job.endCategoryI
        MT_MAX_CATEGORIES = [string]$job.maxCategories
        MT_DELAY_MIN_MS = [string]$config.runtime.delayMinMs
        MT_DELAY_MAX_MS = [string]$config.runtime.delayMaxMs
        MT_CATEGORY_REST_MIN_MS = [string]$config.runtime.categoryRestMinMs
        MT_CATEGORY_REST_MAX_MS = [string]$config.runtime.categoryRestMaxMs
        MT_RISK_SLEEP_MS = [string]$config.runtime.riskSleepMs
        MT_RISK_RETRIES = [string]$config.runtime.riskRetries
        MT_OBSERVED_SMOOTH_CHUNK_SIZE = [string]$config.runtime.observedSmoothChunkSize
        MT_MIN_SMOOTH_CHUNK_SIZE = [string]$config.runtime.minSmoothChunkSize
        MT_DYNAMIC_CHUNK_MODE = [string]$config.runtime.dynamicChunkMode
        MT_ALLOW_PAGE_FALLBACK = ([bool]$config.runtime.allowPageFallback).ToString().ToLowerInvariant()
    }

    # Windows PowerShell 5.1 does not support Start-Process -Environment.
    # Temporarily set process-scoped variables so the child inherits an isolated snapshot.
    $previousEnvironment = @{}
    foreach ($entry in $environment.GetEnumerator()) {
        $previousEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, "Process")
        [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
    }
    try {
        $process = Start-Process `
            -FilePath $node `
            -ArgumentList @($captureScript) `
            -WorkingDirectory $repoRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr `
            -PassThru
    }
    finally {
        foreach ($entry in $previousEnvironment.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
        }
    }

    $pidRecord = [ordered]@{
        jobId = $job.jobId
        pid = $process.Id
        startedAt = (Get-Date).ToString("o")
        outputDir = $outputDir
        stdout = $stdout
        stderr = $stderr
        cdpEndpoint = $job.cdpEndpoint
        cdpPort = $job.cdpPort
        accountId = $job.accountId
        accountLabel = $job.accountLabel
        storeName = $job.storeName
        startCategoryI = $job.startCategoryI
        endCategoryI = $job.endCategoryI
        maxCategories = $job.maxCategories
    }
    $pidRecord | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $pidFile -Encoding UTF8
    $results += [pscustomobject]@{
        jobId = $job.jobId
        pid = $process.Id
        status = "started"
        outputDir = $outputDir
    }
}

$results | ConvertTo-Json -Depth 4
