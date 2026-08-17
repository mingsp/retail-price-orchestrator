[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^worker-[A-Za-z0-9-]+$')][string]$WorkerId,
  [Parameter(Mandatory = $true)][string]$MasterUrl,
  [string]$MasterCaCertificatePath = 'D:\SpanAI\retail-radar-master\certificates\master-root.crt',
  [ValidateRange(30, 600)][int]$TimeoutSeconds = 180,
  [int[]]$ExpectedPorts = @(),
  [switch]$LaunchProfiles,
  [string]$LoginUrl
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$baseUri = [uri]$MasterUrl
if (-not $baseUri.IsAbsoluteUri -or $baseUri.Scheme -ne 'https' -or $baseUri.UserInfo) {
  throw 'MasterUrl must be an HTTPS URL without embedded credentials'
}
if (-not (Test-Path -LiteralPath $MasterCaCertificatePath -PathType Leaf)) {
  throw 'master_ca_certificate_missing'
}
$base = $MasterUrl.TrimEnd('/')

function Invoke-CurlJson([string]$Method, [string]$Url, [object]$Body) {
  $responseFile = Join-Path $env:TEMP ('retail-radar-response-' + [guid]::NewGuid().ToString('N') + '.json')
  $requestFile = $null
  try {
    $arguments = @(
      '--silent', '--show-error', '--fail', '--ssl-no-revoke', '--noproxy', '*',
      '--cacert', $MasterCaCertificatePath, '--output', $responseFile,
      '--request', $Method
    )
    if ($null -ne $Body) {
      $requestFile = Join-Path $env:TEMP ('retail-radar-request-' + [guid]::NewGuid().ToString('N') + '.json')
      [IO.File]::WriteAllText($requestFile, ($Body | ConvertTo-Json -Depth 8 -Compress), [Text.UTF8Encoding]::new($false))
      $arguments += @('--header', 'Content-Type: application/json', '--data-binary', "@$requestFile")
    }
    $arguments += $Url
    & curl.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "master_api_request_failed:$Method" }
    return [IO.File]::ReadAllText($responseFile, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
  } finally {
    foreach ($path in @($responseFile, $requestFile)) {
      if ($path -and (Test-Path -LiteralPath $path)) { Remove-Item -LiteralPath $path -Force }
    }
  }
}

function Invoke-CurlText([string]$Url) {
  $responseFile = Join-Path $env:TEMP ('retail-radar-response-' + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    & curl.exe --silent --show-error --fail --ssl-no-revoke --noproxy '*' `
      --cacert $MasterCaCertificatePath --output $responseFile $Url
    if ($LASTEXITCODE -ne 0) { throw 'master_api_request_failed:GET' }
    return [IO.File]::ReadAllText($responseFile, [Text.UTF8Encoding]::new($false))
  } finally {
    if (Test-Path -LiteralPath $responseFile) { Remove-Item -LiteralPath $responseFile -Force }
  }
}

if ($LaunchProfiles) {
  if ($ExpectedPorts.Count -eq 0) { throw 'ExpectedPorts is required when LaunchProfiles is enabled' }
  if (-not $LoginUrl) { throw 'LoginUrl is required when LaunchProfiles is enabled' }
  $loginUri = [uri]$LoginUrl
  if (
    -not $loginUri.IsAbsoluteUri -or
    $loginUri.Scheme -ne 'https' -or
    $loginUri.Host -ne 'h5.waimai.meituan.com' -or
    $loginUri.AbsolutePath -ne '/login' -or
    $loginUri.Query -or
    $loginUri.Fragment -or
    $loginUri.UserInfo
  ) {
    throw 'LoginUrl must be the query-free Meituan H5 login page'
  }
  $metrics = Invoke-CurlText "$base/metrics"
  if ($metrics -notmatch '(?m)^retail_orchestrator_active_tasks 0$') {
    throw 'active_tasks_block_profile_launch'
  }
}

$encodedWorkerId = [uri]::EscapeDataString($WorkerId)
$endpointResponse = Invoke-CurlJson 'GET' "$base/api/cdp-endpoints?workerId=$encodedWorkerId" $null
$eligible = @($endpointResponse.cdpEndpoints | Where-Object {
  $_.workerId -eq $WorkerId -and
  $_.profileId -and
  $_.status -notin @('manual_required', 'profile_risk', 'retired') -and
  (-not $LaunchProfiles -or $ExpectedPorts -contains [int]$_.port)
})
if ($eligible.Count -eq 0) { throw 'no_refreshable_cdp_endpoints' }
if ($LaunchProfiles) {
  $actualPorts = @($eligible | ForEach-Object { [int]$_.port } | Sort-Object -Unique)
  $expected = @($ExpectedPorts | Sort-Object -Unique)
  if (($actualPorts -join ',') -ne ($expected -join ',')) { throw 'profile_launch_port_inventory_mismatch' }
}

$commandIds = [Collections.Generic.List[string]]::new()
$commandAction = if ($LaunchProfiles) { 'launch_profile' } else { 'open_identity_page' }
foreach ($endpoint in $eligible) {
  $payload = [ordered]@{
    workerId = $WorkerId
    action = $commandAction
    port = [int]$endpoint.port
    profileId = [string]$endpoint.profileId
    endpointId = [string]$endpoint.endpointId
    proxyMode = 'system'
    note = if ($LaunchProfiles) { 'profile_launch_identity_page_only_no_store_navigation' } else { 'runtime_inventory_refresh_no_store_navigation' }
  }
  foreach ($name in @('slotId', 'accountId', 'accountDisplayName', 'maskedLogin', 'operatorOwner', 'targetStoreId', 'targetStoreName')) {
    if ($endpoint.$name) { $payload[$name] = $endpoint.$name }
  }
  if ($LaunchProfiles) { $payload['launchUrl'] = $LoginUrl }
  $created = Invoke-CurlJson 'POST' "$base/api/cdp-commands" $payload
  [void]$commandIds.Add([string]$created.command.commandId)
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  Start-Sleep -Seconds 3
  $commandResponse = Invoke-CurlJson 'GET' "$base/api/cdp-commands?workerId=$encodedWorkerId" $null
  $commands = @($commandResponse.commands | Where-Object { $commandIds.Contains([string]$_.commandId) })
  $pending = @($commands | Where-Object { $_.status -notin @('completed', 'failed', 'cancelled') })
} while (($commands.Count -lt $commandIds.Count -or $pending.Count -gt 0) -and (Get-Date) -lt $deadline)

if ($commands.Count -lt $commandIds.Count -or $pending.Count -gt 0) {
  throw 'cdp_runtime_refresh_timeout'
}
$failed = @($commands | Where-Object { $_.status -ne 'completed' })
if ($failed.Count -gt 0) {
  $ports = ($failed | ForEach-Object { $_.port }) -join ','
  throw "cdp_runtime_refresh_failed_ports:$ports"
}

[pscustomobject]@{
  success = $true
  workerId = $WorkerId
  refreshed = $commands.Count
  ports = @($commands | Sort-Object port | ForEach-Object { $_.port })
  action = $commandAction
  storeNavigation = $false
} | ConvertTo-Json -Depth 4 -Compress
