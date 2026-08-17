[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AssignmentPath,
  [Parameter(Mandatory = $true)][string]$MasterUrl,
  [string]$ConfigPath = 'D:\SpanAI\retail-radar-master\config\production-deploy.env',
  [string]$MasterCaCertificatePath = 'D:\SpanAI\retail-radar-master\certificates\master-root.crt',
  [ValidateRange(30, 600)][int]$TimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

function Import-PrivateEnvironment([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'assignment_private_config_missing' }
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if (-not $line -or $line.TrimStart().StartsWith('#')) { continue }
    $parts = $line.Split('=', 2)
    if ($parts.Count -eq 2) {
      [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], 'Process')
    }
  }
}

function Invoke-CurlJson([string]$Method, [string]$Path, [object]$Body = $null) {
  $responseFile = Join-Path $env:TEMP ('retail-radar-response-' + [guid]::NewGuid().ToString('N') + '.json')
  $requestFile = $null
  try {
    $arguments = @(
      '--silent', '--show-error', '--fail-with-body', '--ssl-no-revoke', '--noproxy', '*',
      '--cacert', $MasterCaCertificatePath, '--output', $responseFile, '--request', $Method
    )
    if ($env:OPERATOR_TOKEN) {
      $arguments += @('--header', ('x-retail-operator-token: ' + $env:OPERATOR_TOKEN))
    }
    if ($null -ne $Body) {
      $requestFile = Join-Path $env:TEMP ('retail-radar-request-' + [guid]::NewGuid().ToString('N') + '.json')
      [IO.File]::WriteAllText($requestFile, ($Body | ConvertTo-Json -Depth 8 -Compress), [Text.UTF8Encoding]::new($false))
      $arguments += @('--header', 'Content-Type: application/json', '--data-binary', "@$requestFile")
    }
    $arguments += ($script:base + $Path)
    & curl.exe @arguments
    if ($LASTEXITCODE -ne 0) {
      $detail = if (Test-Path -LiteralPath $responseFile) {
        [IO.File]::ReadAllText($responseFile, [Text.UTF8Encoding]::new($false))
      } else { '' }
      if ($detail.Length -gt 300) { $detail = $detail.Substring(0, 300) }
      throw "master_api_request_failed:${Method}:${Path}:${detail}"
    }
    $text = [IO.File]::ReadAllText($responseFile, [Text.UTF8Encoding]::new($false))
    return $text | ConvertFrom-Json
  } finally {
    foreach ($file in @($responseFile, $requestFile)) {
      if ($file -and (Test-Path -LiteralPath $file)) { Remove-Item -LiteralPath $file -Force }
    }
  }
}

function Require-Text([object]$Value, [string]$Code) {
  $text = [string]$Value
  if (-not $text.Trim()) { throw $Code }
  return $text.Trim()
}

if (-not (Test-Path -LiteralPath $AssignmentPath -PathType Leaf)) { throw 'assignment_map_missing' }
if (-not (Test-Path -LiteralPath $MasterCaCertificatePath -PathType Leaf)) { throw 'master_ca_certificate_missing' }
$baseUri = [uri]$MasterUrl
if (-not $baseUri.IsAbsoluteUri -or $baseUri.Scheme -ne 'https' -or $baseUri.UserInfo) {
  throw 'MasterUrl must be an HTTPS URL without embedded credentials'
}
$script:base = $MasterUrl.TrimEnd('/')
Import-PrivateEnvironment $ConfigPath

$document = [IO.File]::ReadAllText($AssignmentPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
$assignments = @($document.assignments)
if ($assignments.Count -eq 0) { throw 'assignment_map_empty' }

$seenAccounts = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$seenSlots = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$seenWorkerPorts = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($assignment in $assignments) {
  $assignment.workerId = Require-Text $assignment.workerId 'assignment_worker_missing'
  $assignment.profileId = Require-Text $assignment.profileId 'assignment_profile_missing'
  $assignment.slotId = Require-Text $assignment.slotId 'assignment_slot_missing'
  $assignment.endpointId = Require-Text $assignment.endpointId 'assignment_endpoint_missing'
  $assignment.displayName = Require-Text $assignment.displayName 'assignment_account_missing'
  $assignment.targetStoreId = Require-Text $assignment.targetStoreId 'assignment_store_missing'
  $assignment.targetStoreName = Require-Text $assignment.targetStoreName 'assignment_store_name_missing'
  $assignment.port = [int]$assignment.port
  if ($assignment.workerId -notmatch '^worker-[A-Za-z0-9-]+$') { throw 'assignment_worker_invalid' }
  if ($assignment.port -lt 1024 -or $assignment.port -gt 65535) { throw 'assignment_port_invalid' }
  if (-not $seenAccounts.Add($assignment.displayName)) { throw "duplicate_assignment_account:$($assignment.displayName)" }
  if (-not $seenSlots.Add($assignment.slotId)) { throw "duplicate_assignment_slot:$($assignment.slotId)" }
  if (-not $seenWorkerPorts.Add("$($assignment.workerId):$($assignment.port)")) { throw 'duplicate_assignment_worker_port' }
}

$commandsBefore = @(Invoke-CurlJson 'GET' '/api/cdp-commands').commands
if (@($commandsBefore | Where-Object { $_.status -in @('pending', 'claimed', 'running') }).Count -gt 0) {
  throw 'active_cdp_commands_exist'
}
$accounts = @(Invoke-CurlJson 'GET' '/api/account-pool').accounts
$endpoints = @(Invoke-CurlJson 'GET' '/api/cdp-endpoints').cdpEndpoints
$stores = @(Invoke-CurlJson 'GET' '/api/stores').stores
$resolved = @()
foreach ($assignment in $assignments) {
  $account = @($accounts | Where-Object { $_.displayName -eq $assignment.displayName })
  if ($account.Count -ne 1) { throw "assignment_account_resolution_failed:$($assignment.displayName)" }
  if ($account[0].status -notin @('available', 'reserved')) { throw "assignment_account_unavailable:$($assignment.displayName)" }
  $endpoint = @($endpoints | Where-Object {
    $_.workerId -eq $assignment.workerId -and [int]$_.port -eq $assignment.port -and $_.endpointId -eq $assignment.endpointId
  })
  if ($endpoint.Count -ne 1) { throw "assignment_endpoint_resolution_failed:$($assignment.workerId):$($assignment.port)" }
  if ($endpoint[0].profileId -ne $assignment.profileId) { throw "assignment_profile_mismatch:$($assignment.port)" }
  if ($endpoint[0].status -in @('profile_risk', 'retired')) { throw "assignment_endpoint_unavailable:$($assignment.port)" }
  $store = @($stores | Where-Object { $_.storeId -eq $assignment.targetStoreId -and $_.status -eq 'active' })
  if ($store.Count -ne 1) { throw "assignment_store_not_active:$($assignment.targetStoreId)" }
  $resolved += [pscustomobject]@{ assignment = $assignment; account = $account[0] }
}

$commandIds = [Collections.Generic.List[string]]::new()
foreach ($item in $resolved) {
  $assignment = $item.assignment
  $account = $item.account
  $payload = [ordered]@{
    slotId = $assignment.slotId
    workerId = $assignment.workerId
    action = 'open_identity_page'
    port = $assignment.port
    profileId = $assignment.profileId
    endpointId = $assignment.endpointId
    accountId = $account.accountId
    accountDisplayName = $account.displayName
    maskedLogin = $account.maskedLogin
    operatorOwner = $account.operatorOwner
    targetStoreId = $assignment.targetStoreId
    targetStoreName = $assignment.targetStoreName
    proxyMode = 'system'
    note = 'account_assignment_identity_page_only_no_store_navigation'
  }
  $created = Invoke-CurlJson 'POST' '/api/cdp-commands' $payload
  [void]$commandIds.Add([string]$created.command.commandId)
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  Start-Sleep -Seconds 3
  $commands = @((Invoke-CurlJson 'GET' '/api/cdp-commands').commands | Where-Object { $commandIds.Contains([string]$_.commandId) })
  $pending = @($commands | Where-Object { $_.status -notin @('completed', 'failed', 'cancelled') })
} while (($commands.Count -lt $commandIds.Count -or $pending.Count -gt 0) -and (Get-Date) -lt $deadline)

if ($commands.Count -lt $commandIds.Count -or $pending.Count -gt 0) { throw 'identity_page_commands_timeout' }
$failed = @($commands | Where-Object { $_.status -ne 'completed' })
if ($failed.Count -gt 0) {
  $ports = ($failed | ForEach-Object { "$($_.port):$($_.lastError)" }) -join ','
  throw "identity_page_commands_failed:$ports"
}

foreach ($item in $resolved) {
  $assignment = $item.assignment
  [void](Invoke-CurlJson 'PATCH' ("/api/account-pool/$([uri]::EscapeDataString($item.account.accountId))") @{
    status = 'reserved'
    note = "login_reserved | $($assignment.targetStoreName) | CDP $($assignment.port)"
  })
}

[pscustomobject]@{
  success = $true
  completed = $commands.Count
  storeNavigation = $false
  collectionStarted = $false
  assignments = @($resolved | ForEach-Object {
    [pscustomobject]@{
      workerId = $_.assignment.workerId
      port = $_.assignment.port
      profileId = $_.assignment.profileId
      displayName = $_.account.displayName
      maskedLogin = $_.account.maskedLogin
      targetStoreName = $_.assignment.targetStoreName
    }
  })
} | ConvertTo-Json -Depth 5 -Compress
