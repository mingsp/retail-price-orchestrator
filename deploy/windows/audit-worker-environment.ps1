[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'

function Get-CommandVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$Arguments = @('--version')
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    $lines = & $command.Source @Arguments 2>&1 | Select-Object -First 3
    return (($lines | ForEach-Object { $_.ToString() }) -join ' | ')
}

$operatingSystem = Get-CimInstance Win32_OperatingSystem
$computerSystem = Get-CimInstance Win32_ComputerSystem
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
$systemDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$programFilesX86\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromePath = $chromeCandidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
$chromeVersion = if ($chromePath) { (Get-Item -LiteralPath $chromePath).VersionInfo.ProductVersion } else { $null }

$chromeProcesses = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'")
$cdpParents = @($chromeProcesses | Where-Object { $_.CommandLine -match '--remote-debugging-port=' })
$cdp = @($cdpParents | ForEach-Object {
    $port = if ($_.CommandLine -match '--remote-debugging-port=(\d+)') { $matches[1] } else { $null }
    $profile = if ($_.CommandLine -match '--user-data-dir=(?:"([^"]+)"|(\S+))') {
        if ($matches[1]) { $matches[1] } else { $matches[2] }
    } else {
        $null
    }
    [pscustomobject]@{
        processId = $_.ProcessId
        port = $port
        profile = $profile
    }
})

$network = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -ne $null } |
    Select-Object -First 1
$dockerReady = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker info --format '{{json .ServerVersion}}' 2>$null | Out-Null
    $dockerReady = $LASTEXITCODE -eq 0
}

$existingPaths = @(
    'C:\ProgramData\RetailRadar',
    'C:\ProgramData\RetailRadar66',
    'C:\SpanAI',
    'D:\SpanAI',
    'C:\work',
    'D:\work'
) | ForEach-Object {
    [pscustomobject]@{
        path = $_
        exists = Test-Path -LiteralPath $_
    }
}

[pscustomobject]@{
    hostName = $env:COMPUTERNAME
    user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    isAdministrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
    operatingSystem = [pscustomobject]@{
        caption = $operatingSystem.Caption
        version = $operatingSystem.Version
        build = $operatingSystem.BuildNumber
        lastBoot = $operatingSystem.LastBootUpTime
    }
    cpu = [pscustomobject]@{
        name = $processor.Name
        logicalProcessors = $computerSystem.NumberOfLogicalProcessors
    }
    memoryGB = [pscustomobject]@{
        total = [math]::Round($computerSystem.TotalPhysicalMemory / 1GB, 2)
        available = [math]::Round($operatingSystem.FreePhysicalMemory * 1KB / 1GB, 2)
    }
    systemDriveGB = [pscustomobject]@{
        total = [math]::Round($systemDrive.Size / 1GB, 2)
        free = [math]::Round($systemDrive.FreeSpace / 1GB, 2)
    }
    network = [pscustomobject]@{
        ipv4 = @($network.IPv4Address.IPAddress)
        gateway = $network.IPv4DefaultGateway.NextHop
        adapter = $network.InterfaceAlias
        mac = (Get-NetAdapter -InterfaceIndex $network.InterfaceIndex).MacAddress
    }
    versions = [pscustomobject]@{
        powerShell = $PSVersionTable.PSVersion.ToString()
        git = Get-CommandVersion -Name 'git'
        node = Get-CommandVersion -Name 'node'
        npm = Get-CommandVersion -Name 'npm'
        pnpm = Get-CommandVersion -Name 'pnpm'
        docker = Get-CommandVersion -Name 'docker'
        dockerCompose = if (Get-Command docker -ErrorAction SilentlyContinue) {
            (& docker compose version 2>&1 | Select-Object -First 1).ToString()
        } else {
            $null
        }
        codex = Get-CommandVersion -Name 'codex'
        chrome = $chromeVersion
        chromePath = $chromePath
    }
    services = [pscustomobject]@{
        docker = Get-Service 'com.docker.service' | Select-Object Status, StartType
        sshd = Get-Service 'sshd' | Select-Object Status, StartType
        retailRadarWorker = Get-Service 'RetailRadarWorker' | Select-Object Status, StartType
    }
    dockerReady = $dockerReady
    chromeProcessCount = $chromeProcesses.Count
    cdpParents = $cdp
    existingPaths = $existingPaths
    winHttpProxy = ((& netsh winhttp show proxy) -join ' | ')
} | ConvertTo-Json -Depth 7 -Compress
