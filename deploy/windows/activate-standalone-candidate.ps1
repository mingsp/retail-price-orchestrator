[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][ValidatePattern('^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit,
    [string]$StateRoot = 'C:\ProgramData\RetailRadar\Standalone',
    [string]$StartupTaskName = 'RetailRadarStandaloneStart',
    [switch]$EnableObservability
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-acl.ps1')

function Set-EnvironmentValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $lines = if (Test-Path -LiteralPath $Path) { @(Get-Content -LiteralPath $Path -Encoding UTF8) } else { @() }
    $result = [Collections.Generic.List[string]]::new()
    $replaced = $false
    foreach ($line in $lines) {
        if ($line -match "^$([regex]::Escape($Name))=") {
            if (-not $replaced) { $result.Add("$Name=$Value") }
            $replaced = $true
            continue
        }
        $result.Add($line)
    }
    if (-not $replaced) { $result.Add("$Name=$Value") }
    [IO.File]::WriteAllLines($Path, $result, [Text.UTF8Encoding]::new($false))
}

function Get-VersionDocument {
    param([Parameter(Mandatory = $true)][string]$MasterHostname)
    $output = & curl.exe --silent --show-error --fail --insecure `
        --resolve "${MasterHostname}:2808:127.0.0.1" "https://${MasterHostname}:2808/api/version"
    if ($LASTEXITCODE -ne 0) { throw 'Version endpoint is unavailable after activation' }
    try { return ($output | ConvertFrom-Json) } catch { throw 'Version endpoint returned invalid JSON' }
}

$project = [IO.Path]::GetFullPath($ProjectRoot)
$state = [IO.Path]::GetFullPath($StateRoot)
$environmentPath = Join-Path $state 'config\.env.production'
$verificationPath = Join-Path $project 'candidate-verification.json'
$packagePath = Join-Path $project 'package.json'
$startScript = Join-Path $project 'deploy\windows\start-standalone-node.ps1'
$observabilityScript = Join-Path $project 'deploy\windows\configure-observability.ps1'
$alertmanagerConfigPath = Join-Path $state 'config\alertmanager.generated.yml'
foreach ($required in @($environmentPath, $verificationPath, $packagePath, $startScript)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required activation input is missing: $required" }
}
$masterHostnameLine = Get-Content -LiteralPath $environmentPath -Encoding UTF8 | Where-Object { $_ -match '^MASTER_HOSTNAME=' } | Select-Object -First 1
$masterHostname = if ($masterHostnameLine) { $masterHostnameLine.Substring('MASTER_HOSTNAME='.Length).Trim() } else { '' }
if ($masterHostname -notmatch '^[A-Za-z0-9.-]+$') { throw 'MASTER_HOSTNAME is missing or invalid' }

$verification = Get-Content -LiteralPath $verificationPath -Raw -Encoding UTF8 | ConvertFrom-Json
$package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$normalizedVersion = $ExpectedVersion.TrimStart('v')
if ($verification.status -ne 'candidate_verified' -or $verification.activation -ne 'not_switched') {
    throw 'Candidate verification state does not permit activation'
}
if ($verification.commit -ne $ExpectedCommit -or $verification.tag.TrimStart('v') -ne $normalizedVersion) {
    throw 'Candidate tag or commit does not match the activation request'
}
if ($package.version -ne $normalizedVersion) { throw 'Package version does not match the activation request' }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$rollbackRoot = Join-Path $state "backups\activation-$timestamp"
New-Item -ItemType Directory -Force -Path $rollbackRoot | Out-Null
Protect-RetailRadarPath -Path $rollbackRoot -Container
$environmentBackup = Join-Path $rollbackRoot 'standalone.env.production'
Copy-Item -LiteralPath $environmentPath -Destination $environmentBackup

$task = Get-ScheduledTask -TaskName $StartupTaskName -ErrorAction SilentlyContinue
$taskXmlPath = Join-Path $rollbackRoot 'startup-task.xml'
if ($task) { Export-ScheduledTask -TaskName $StartupTaskName | Set-Content -LiteralPath $taskXmlPath -Encoding UTF8 }

try {
    if ($EnableObservability) {
        if (-not (Test-Path -LiteralPath $observabilityScript -PathType Leaf)) { throw 'Observability configuration script is missing' }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $observabilityScript `
            -ProductionEnvPath $environmentPath -OutputConfigPath $alertmanagerConfigPath
        if ($LASTEXITCODE -ne 0) { throw 'Observability configuration failed' }
    }

    Set-EnvironmentValue -Path $environmentPath -Name 'RETAIL_RADAR_VERSION' -Value $normalizedVersion
    Set-EnvironmentValue -Path $environmentPath -Name 'RETAIL_RADAR_GIT_SHA' -Value $ExpectedCommit
    Set-EnvironmentValue -Path $environmentPath -Name 'RETAIL_RADAR_BUILT_AT' -Value ((Get-Date).ToUniversalTime().ToString('o'))

    $startArguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startScript,
        '-ProjectRoot', $project, '-StateRoot', $state
    )
    if ($EnableObservability) { $startArguments += '-EnableObservability' }
    & powershell.exe @startArguments
    if ($LASTEXITCODE -ne 0) { throw 'Candidate startup failed' }

    $versionDocument = Get-VersionDocument -MasterHostname $masterHostname
    $reportedVersion = if ($versionDocument.version) { [string]$versionDocument.version } else { [string]$versionDocument.release.version }
    $reportedCommit = if ($versionDocument.gitSha) { [string]$versionDocument.gitSha } else { [string]$versionDocument.release.gitSha }
    if ($reportedVersion -ne $normalizedVersion -or $reportedCommit -ne $ExpectedCommit) {
        throw "Activated API identity mismatch: version=$reportedVersion commit=$reportedCommit"
    }

    $taskActionArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -ProjectRoot `"$project`" -StateRoot `"$state`""
    if ($EnableObservability) { $taskActionArguments += ' -EnableObservability' }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskActionArguments
    if ($task) {
        Set-ScheduledTask -TaskName $StartupTaskName -Action $action | Out-Null
    } else {
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)
        Register-ScheduledTask -TaskName $StartupTaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
    }

    $verification.activation = 'switched'
    $verification.activatedAt = (Get-Date).ToUniversalTime().ToString('o')
    [IO.File]::WriteAllText($verificationPath, ($verification | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

    [pscustomobject]@{
        status = 'activated'
        version = $reportedVersion
        commit = $reportedCommit
        projectRoot = $project
        rollbackEvidence = $rollbackRoot
        startupTask = $StartupTaskName
        observability = $EnableObservability.IsPresent
    } | ConvertTo-Json -Compress
}
catch {
    Copy-Item -LiteralPath $environmentBackup -Destination $environmentPath -Force
    if (Test-Path -LiteralPath $taskXmlPath -PathType Leaf) {
        Register-ScheduledTask -TaskName $StartupTaskName -Xml (Get-Content -LiteralPath $taskXmlPath -Raw -Encoding UTF8) -Force | Out-Null
        Start-ScheduledTask -TaskName $StartupTaskName
    }
    throw
}
