[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PolicyPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-EnvValue {
  param([string]$Path, [string]$Name)
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match ('^' + [regex]::Escape($Name) + '=') } | Select-Object -Last 1
  if (-not $line) { return $null }
  return ($line -split '=', 2)[1].Trim()
}

function Write-State {
  param([string]$Path, [object]$Value)
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
}

function Send-DingTalk {
  param([string]$Webhook, [string]$Message)
  $body = @{ msgtype = 'text'; text = @{ content = $Message } } | ConvertTo-Json -Depth 4 -Compress
  $response = Invoke-RestMethod -Method Post -Uri $Webhook -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 15
  if ([int]$response.errcode -ne 0) { throw "DingTalk rejected peer health notification" }
}

$policy = Get-Content -LiteralPath (Resolve-Path -LiteralPath $PolicyPath).Path -Raw -Encoding UTF8 | ConvertFrom-Json
$statePath = [string]$policy.statePath
$threshold = if ($policy.failureThreshold) { [int]$policy.failureThreshold } else { 2 }
if ($threshold -lt 1 -or $threshold -gt 10) { throw 'failureThreshold must be between 1 and 10' }
$webhook = Read-EnvValue -Path ([string]$policy.environmentFile) -Name 'DINGTALK_WEBHOOK_URL'
if ([string]::IsNullOrWhiteSpace($webhook)) { throw 'DingTalk webhook is missing from the protected environment file' }
$uri = [uri]([string]$policy.healthUrl)
if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo) { throw 'healthUrl must be HTTPS without credentials' }

$previous = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$previousStatus = if ($previous) { [string]$previous.status } else { 'unknown' }
$previousFailureCount = if ($previous) { [int]$previous.failureCount } else { 0 }
$healthy = $false
try {
  $curlArgs = @('--silent','--show-error','--fail','--ssl-no-revoke','--noproxy','*','--max-time','15')
  if ($policy.caCertificatePath) { $curlArgs += @('--cacert', [string]$policy.caCertificatePath) }
  $curlArgs += [string]$policy.healthUrl
  $response = & curl.exe @curlArgs
  $healthy = $LASTEXITCODE -eq 0 -and ($response | ConvertFrom-Json).ok -eq $true
} catch { $healthy = $false }

$failureCount = if ($healthy) { 0 } else { $previousFailureCount + 1 }
$status = if ($healthy) { 'healthy' } elseif ($failureCount -ge $threshold) { 'unavailable' } else { 'suspected' }
$notificationState = 'none'

if ($status -eq 'unavailable' -and $previousStatus -ne 'unavailable') {
  try {
    Send-DingTalk -Webhook $webhook -Message "商圈比价 系统提醒`n服务: $([string]$policy.peerName)`n状态: 暂时不可用`n处理: 请检查对应设备和调度服务"
    $notificationState = 'sent'
  } catch {
    $notificationState = 'outcome_unknown'
  }
} elseif ($status -eq 'healthy' -and $previousStatus -eq 'unavailable') {
  try {
    Send-DingTalk -Webhook $webhook -Message "商圈比价 系统状态已恢复`n服务: $([string]$policy.peerName)`n状态: 已恢复"
    $notificationState = 'sent'
  } catch {
    $notificationState = 'outcome_unknown'
  }
}

$state = [ordered]@{
  peerName = [string]$policy.peerName
  checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
  status = $status
  failureCount = $failureCount
  notificationState = $notificationState
}
Write-State -Path $statePath -Value $state
$state | ConvertTo-Json -Compress
