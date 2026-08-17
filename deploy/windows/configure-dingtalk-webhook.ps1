[CmdletBinding()]
param(
  [string]$WorkspaceRoot = 'D:\SpanAI\retail-radar-master\workspace\retail-price-orchestrator',
  [string]$ConfigRoot = 'D:\SpanAI\retail-radar-master\config'
)

$ErrorActionPreference = 'Stop'
$environmentPath = Join-Path $ConfigRoot 'production-deploy.env'
$composePath = Join-Path $WorkspaceRoot 'infra\docker-compose.production.yml'
$backupPath = Join-Path $ConfigRoot ("production-deploy.{0}.bak.env" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$temporaryPath = "$environmentPath.tmp"
$configurationChanged = $false

function Protect-SecretFile([string]$Path) {
  & icacls.exe $Path /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' "$env:USERNAME`:F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "secret_file_acl_failed:$Path" }
}

function Read-KeyValueFile([string]$Path) {
  $values = [ordered]@{}
  Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
    if ($_ -and -not $_.StartsWith('#')) {
      $parts = $_.Split('=', 2)
      if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1] }
    }
  }
  return $values
}

if (-not (Test-Path -LiteralPath $environmentPath)) { throw "deployment_environment_missing:$environmentPath" }
if (-not (Test-Path -LiteralPath $composePath)) { throw "production_compose_missing:$composePath" }

$secureWebhook = Read-Host '请输入钉钉自定义机器人 Webhook（输入内容不会显示）' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureWebhook)
$webhook = $null
try {
  $webhook = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
  $uri = $null
  if (-not [Uri]::TryCreate($webhook, [UriKind]::Absolute, [ref]$uri)) { throw 'dingtalk_webhook_invalid_url' }
  if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'oapi.dingtalk.com' -or $uri.AbsolutePath -ne '/robot/send') {
    throw 'dingtalk_webhook_must_be_official_https_robot_url'
  }
  if (-not $uri.Query.Contains('access_token=')) { throw 'dingtalk_webhook_access_token_missing' }

  $deployment = Read-KeyValueFile $environmentPath
  Copy-Item -LiteralPath $environmentPath -Destination $backupPath -Force
  Protect-SecretFile $backupPath
  $deployment['DINGTALK_WEBHOOK_URL'] = $webhook

  [IO.File]::WriteAllLines(
    $temporaryPath,
    @($deployment.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }),
    [Text.UTF8Encoding]::new($false)
  )
  Protect-SecretFile $temporaryPath
  Move-Item -LiteralPath $temporaryPath -Destination $environmentPath -Force
  Protect-SecretFile $environmentPath
  $configurationChanged = $true

  $chromeBefore = @(Get-Process chrome -ErrorAction SilentlyContinue).Count
  Set-Location (Join-Path $WorkspaceRoot 'infra')
  docker compose --project-name retail-radar --env-file $environmentPath -f docker-compose.production.yml up -d --no-deps master
  if ($LASTEXITCODE -ne 0) { throw 'master_compose_restart_failed' }

  $ready = $false
  $masterBaseUrl = $deployment['MASTER_PUBLIC_BASE_URL'].TrimEnd('/')
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    Start-Sleep -Seconds 2
    try {
      $response = (& curl.exe -ksS --max-time 5 "$masterBaseUrl/ready") | ConvertFrom-Json
      if ($response.ok) { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) { throw 'master_not_ready_after_webhook_configuration' }

  [pscustomobject]@{
    success = $true
    webhookConfigured = $true
    webhookValuePrinted = $false
    backupCreated = $true
    masterReady = $true
    chromeBefore = $chromeBefore
    chromeAfter = @(Get-Process chrome -ErrorAction SilentlyContinue).Count
  } | ConvertTo-Json -Compress
} catch {
  if ($configurationChanged -and (Test-Path -LiteralPath $backupPath)) {
    Copy-Item -LiteralPath $backupPath -Destination $environmentPath -Force
    Protect-SecretFile $environmentPath
    Set-Location (Join-Path $WorkspaceRoot 'infra')
    docker compose --project-name retail-radar --env-file $environmentPath -f docker-compose.production.yml up -d --no-deps master | Out-Null
  }
  throw
} finally {
  if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $webhook = $null
  $secureWebhook = $null
}
