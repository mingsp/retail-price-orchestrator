[CmdletBinding()]
param(
    [string]$InstallRoot = "$env:ProgramData\RetailRadar\Worker"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$environmentPath = Join-Path $InstallRoot 'config\worker.env'
$identityPath = Join-Path $InstallRoot 'state\worker-identity.json'
$packagePath = Join-Path $InstallRoot 'current\package.json'
foreach ($path in @($environmentPath, $identityPath, $packagePath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Worker runtime file is missing: $path"
    }
}

$environment = @{}
foreach ($line in @(Get-Content -LiteralPath $environmentPath -Encoding UTF8)) {
    if ($line -match '^([^#=]+)=(.*)$') { $environment[$matches[1]] = $matches[2] }
}

$decodedLabel = $null
if ($environment['WORKER_MACHINE_LABEL_BASE64']) {
    try {
        $decodedLabel = [Text.UTF8Encoding]::new($false, $true).GetString(
            [Convert]::FromBase64String($environment['WORKER_MACHINE_LABEL_BASE64'])
        )
    }
    catch {
        $decodedLabel = '<invalid-base64-label>'
    }
}

$endpoints = @()
if ($environment['WORKER_CDP_ENDPOINTS_JSON']) {
    try { $endpoints = @($environment['WORKER_CDP_ENDPOINTS_JSON'] | ConvertFrom-Json) } catch {}
}
$accounts = @()
if ($environment['WORKER_ACCOUNTS_JSON']) {
    try { $accounts = @($environment['WORKER_ACCOUNTS_JSON'] | ConvertFrom-Json) } catch {}
}

$identity = Get-Content -LiteralPath $identityPath -Raw -Encoding UTF8 | ConvertFrom-Json
$package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$helper = Get-ScheduledTask -TaskName 'RetailRadarCdpHelper' -ErrorAction SilentlyContinue

[pscustomobject]@{
    computer = $env:COMPUTERNAME
    workerId = $identity.workerId
    version = $package.version
    plainLabel = $environment['WORKER_MACHINE_LABEL']
    decodedLabel = $decodedLabel
    endpointCount = $endpoints.Count
    ports = @($endpoints | ForEach-Object { $_.port })
    accountCount = $accounts.Count
    service = (Get-Service RetailRadarWorker).Status.ToString()
    helper = if ($helper) { $helper.State.ToString() } else { 'Missing' }
    memoryPercent = [math]::Round(
        (1 - $operatingSystem.FreePhysicalMemory / $operatingSystem.TotalVisibleMemorySize) * 100,
        1
    )
} | ConvertTo-Json -Compress
