[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,
    [string]$ChromePath = "",
    [int]$StartupTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

function Resolve-ChromeExecutable {
    param([string]$ExplicitPath)

    if ($ExplicitPath) {
        if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) {
            throw "Google Chrome was not found at the configured path: $ExplicitPath"
        }
        return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }

    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
    )
    $resolved = $candidates |
        Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
        Select-Object -First 1
    if (-not $resolved) {
        throw "Google Chrome is not installed for the interactive desktop user."
    }
    return (Resolve-Path -LiteralPath $resolved).Path
}

function Get-CdpListener {
    param([int]$Port)

    $listeners = @(
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Sort-Object OwningProcess -Unique
    )
    if ($listeners.Count -gt 1) {
        throw "CDP port $Port has multiple listeners."
    }
    if ($listeners.Count -eq 1) {
        return $listeners[0]
    }
    return $null
}

function Test-CommandLineValue {
    param(
        [string]$CommandLine,
        [string]$Name,
        [string]$Value
    )

    return $CommandLine.Contains("$Name=$Value") -or
        $CommandLine.Contains("$Name=`"$Value`"")
}

function Assert-CdpOwnership {
    param(
        [int]$Port,
        [string]$ProfilePath,
        [string]$ExpectedChromePath
    )

    $listener = Get-CdpListener -Port $Port
    if (-not $listener) {
        return $null
    }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if (-not $process -or $process.ExecutablePath -ne $ExpectedChromePath) {
        throw "CDP port $Port belongs to another process."
    }
    if (-not (Test-CommandLineValue -CommandLine $process.CommandLine -Name "--remote-debugging-port" -Value "$Port")) {
        throw "CDP port $Port is not owned by the expected browser command."
    }
    if (-not (Test-CommandLineValue -CommandLine $process.CommandLine -Name "--user-data-dir" -Value $ProfilePath)) {
        throw "CDP port $Port is attached to a different Profile."
    }
    return $process
}

function Wait-CdpReady {
    param(
        [int]$Port,
        [string]$ProfilePath,
        [string]$ExpectedChromePath,
        [int]$TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 500
        try {
            $process = Assert-CdpOwnership -Port $Port -ProfilePath $ProfilePath -ExpectedChromePath $ExpectedChromePath
            $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 3
            if ($process -and $version.webSocketDebuggerUrl) {
                return $process
            }
        }
        catch {
            if ([DateTime]::UtcNow -ge $deadline) {
                throw
            }
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Chrome CDP on port $Port did not become ready within $TimeoutSeconds seconds."
}

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "CDP configuration file is missing: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$chrome = Resolve-ChromeExecutable -ExplicitPath $ChromePath
$profileRoot = [System.IO.Path]::GetFullPath($config.profileRoot)
[void](New-Item -ItemType Directory -Force -Path $profileRoot)
$pureCollector = $config.profilePolicy -eq "consumer_h5_collection_only"

$results = @()
foreach ($slot in $config.slots) {
    $port = [int]$slot.port
    if ($pureCollector -and $slot.profileName -notmatch "pure") {
        throw "Pure collector policy rejected Profile without a pure generation marker: $($slot.profileName)"
    }
    $profilePath = [System.IO.Path]::GetFullPath((Join-Path $profileRoot $slot.profileName))
    [void](New-Item -ItemType Directory -Force -Path $profilePath)

    $process = Assert-CdpOwnership -Port $port -ProfilePath $profilePath -ExpectedChromePath $chrome
    $started = $false
    if (-not $process) {
        $arguments = @(
            "--remote-debugging-address=127.0.0.1",
            "--remote-debugging-port=$port",
            "--user-data-dir=$profilePath",
            "--profile-directory=Default",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-popup-blocking",
            "--disable-session-crashed-bubble"
        )
        if ($config.directNetwork -eq $true) {
            $arguments += "--no-proxy-server"
        }
        $arguments += "about:blank"
        Start-Process -FilePath $chrome -ArgumentList $arguments -WindowStyle Normal | Out-Null
        $process = Wait-CdpReady `
            -Port $port `
            -ProfilePath $profilePath `
            -ExpectedChromePath $chrome `
            -TimeoutSeconds $StartupTimeoutSeconds
        $started = $true
    }

    $results += [pscustomobject]@{
        slot = $slot.slot
        port = $port
        profile_id = $slot.profileId
        profile_path = $profilePath
        process_id = $process.ProcessId
        started = $started
        endpoint = "http://127.0.0.1:$port"
    }
}

$results | ConvertTo-Json -Depth 3
