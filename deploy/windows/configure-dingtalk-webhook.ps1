[CmdletBinding()]
param(
  [string]$WorkspaceRoot = 'D:\SpanAI\retail-radar-master\app',
  [string]$EnvironmentPath = 'D:\SpanAI\retail-radar-master\config\.env.production',
  [string]$MirrorEnvironmentPath = 'D:\SpanAI\retail-radar-master\config\production-deploy.env',
  [string]$MasterCaCertificatePath = 'D:\SpanAI\retail-radar-master\certificates\master-root.crt',
  [ValidatePattern('^[A-Za-z0-9_-]+$')][string]$ProjectName = 'retail-radar'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-acl.ps1')

$workspace = [IO.Path]::GetFullPath($WorkspaceRoot)
$primaryEnvironment = [IO.Path]::GetFullPath($EnvironmentPath)
$mirrorEnvironment = if ($MirrorEnvironmentPath) { [IO.Path]::GetFullPath($MirrorEnvironmentPath) } else { '' }
$composePath = Join-Path $workspace 'infra\docker-compose.production.yml'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path (Split-Path -Parent $primaryEnvironment) "webhook-backup-$timestamp"
$changed = $false
$secureWebhook = $null
$bstr = [IntPtr]::Zero

function Read-Environment([string]$Path) {
  $values = [ordered]@{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if (-not $line -or $line.TrimStart().StartsWith('#')) { continue }
    $parts = $line.Split('=', 2)
    if ($parts.Count -eq 2) { $values[$parts[0].Trim()] = $parts[1] }
  }
  return $values
}

function Set-EnvironmentValue([string]$Path, [string]$Name, [string]$Value) {
  $lines = [Collections.Generic.List[string]]::new()
  foreach ($line in [IO.File]::ReadAllLines($Path)) { [void]$lines.Add($line) }
  $prefix = "$Name="
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if (-not $lines[$index].StartsWith($prefix, [StringComparison]::Ordinal)) { continue }
    if (-not $found) {
      $lines[$index] = $prefix + $Value
      $found = $true
    } else {
      $lines.RemoveAt($index)
      $index--
    }
  }
  if (-not $found) { [void]$lines.Add($prefix + $Value) }
  $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  [IO.File]::WriteAllLines($temporary, $lines, [Text.UTF8Encoding]::new($false))
  Protect-RetailRadarPath -Path $temporary
  Move-Item -LiteralPath $temporary -Destination $Path -Force
  Protect-RetailRadarPath -Path $Path
}

function Restore-Configuration {
  Copy-Item -LiteralPath (Join-Path $backupRoot 'primary.env') -Destination $primaryEnvironment -Force
  Protect-RetailRadarPath -Path $primaryEnvironment
  if ($mirrorEnvironment -and (Test-Path (Join-Path $backupRoot 'mirror.env') -PathType Leaf)) {
    Copy-Item -LiteralPath (Join-Path $backupRoot 'mirror.env') -Destination $mirrorEnvironment -Force
    Protect-RetailRadarPath -Path $mirrorEnvironment
  }
}

foreach ($required in @($workspace, $primaryEnvironment, $composePath, $MasterCaCertificatePath)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "required_input_missing:$required" }
}
if ($mirrorEnvironment -and -not (Test-Path -LiteralPath $mirrorEnvironment -PathType Leaf)) {
  throw "mirror_environment_missing:$mirrorEnvironment"
}

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
Protect-RetailRadarPath -Path $backupRoot -Container
Copy-Item -LiteralPath $primaryEnvironment -Destination (Join-Path $backupRoot 'primary.env')
Protect-RetailRadarPath -Path (Join-Path $backupRoot 'primary.env')
if ($mirrorEnvironment) {
  Copy-Item -LiteralPath $mirrorEnvironment -Destination (Join-Path $backupRoot 'mirror.env')
  Protect-RetailRadarPath -Path (Join-Path $backupRoot 'mirror.env')
}

try {
  $secureWebhook = Read-Host '请输入钉钉自定义机器人 Webhook（输入内容不会显示）' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureWebhook)
  $webhook = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
  $uri = $null
  if (-not [Uri]::TryCreate($webhook, [UriKind]::Absolute, [ref]$uri)) { throw 'dingtalk_webhook_invalid_url' }
  if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'oapi.dingtalk.com' -or $uri.AbsolutePath -ne '/robot/send') {
    throw 'dingtalk_webhook_must_be_official_https_robot_url'
  }
  if (-not $uri.Query.Contains('access_token=')) { throw 'dingtalk_webhook_access_token_missing' }

  Set-EnvironmentValue -Path $primaryEnvironment -Name 'DINGTALK_WEBHOOK_URL' -Value $webhook
  if ($mirrorEnvironment) {
    Set-EnvironmentValue -Path $mirrorEnvironment -Name 'DINGTALK_WEBHOOK_URL' -Value $webhook
  }
  $changed = $true

  Push-Location (Split-Path -Parent $composePath)
  try {
    & docker.exe compose --project-name $ProjectName --env-file $primaryEnvironment -f $composePath up -d --no-deps --force-recreate master
    if ($LASTEXITCODE -ne 0) { throw 'master_compose_restart_failed' }
  } finally { Pop-Location }

  $environment = Read-Environment $primaryEnvironment
  $masterHostname = [string]$environment['MASTER_HOSTNAME']
  if ($masterHostname -notmatch '^[A-Za-z0-9.-]+$') { throw 'master_hostname_invalid' }
  $resolve = "${masterHostname}:2808:127.0.0.1"
  $readyUrl = "https://${masterHostname}:2808/ready"
  $readinessUrl = "https://${masterHostname}:2808/api/production-readiness"
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Seconds 2
    $body = & curl.exe --silent --show-error --fail --ssl-no-revoke --noproxy '*' --cacert $MasterCaCertificatePath --resolve $resolve $readyUrl
    if ($LASTEXITCODE -eq 0) {
      try { $ready = ($body | ConvertFrom-Json).ok -eq $true } catch { $ready = $false }
    }
    if ($ready) { break }
  }
  if (-not $ready) { throw 'master_not_ready_after_webhook_configuration' }

  $report = (& curl.exe --silent --show-error --fail --ssl-no-revoke --noproxy '*' --cacert $MasterCaCertificatePath --resolve $resolve $readinessUrl) | ConvertFrom-Json
  if (@($report.report.issues | Where-Object { $_.id -eq 'system:dingtalk-notification-missing' }).Count -gt 0) {
    throw 'dingtalk_webhook_not_loaded_by_master'
  }

  [pscustomobject]@{
    success = $true
    webhookConfigured = $true
    webhookValuePrinted = $false
    primaryUpdated = $true
    mirrorUpdated = [bool]$mirrorEnvironment
    backupRoot = $backupRoot
    masterReady = $true
  } | ConvertTo-Json -Compress
} catch {
  if ($changed) {
    Restore-Configuration
    Push-Location (Split-Path -Parent $composePath)
    try {
      & docker.exe compose --project-name $ProjectName --env-file $primaryEnvironment -f $composePath up -d --no-deps --force-recreate master | Out-Null
    } finally { Pop-Location }
  }
  throw
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $webhook = $null
  $secureWebhook = $null
}
