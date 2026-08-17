[CmdletBinding()]
param(
  [string]$WorkspaceRoot = 'D:\SpanAI\retail-radar-master\app',
  [string]$ConfigPath = 'D:\SpanAI\retail-radar-master\config\production-deploy.env',
  [string]$RegistryConfigPath = 'D:\SpanAI\retail-radar-master\config\registry-sync.env',
  [string]$MasterCaCertificatePath = 'D:\SpanAI\retail-radar-master\certificates\master-root.crt',
  [string]$TopologyConfigPath = 'D:\SpanAI\retail-radar-master\config\worker-topology.json',
  [switch]$SkipRegistryDryRun
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

function Import-PrivateEnvironment([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'master_verification_config_missing' }
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if (-not $line -or $line.TrimStart().StartsWith('#')) { continue }
    $parts = $line.Split('=', 2)
    if ($parts.Count -eq 2) {
      [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], 'Process')
    }
  }
}

function ConvertTo-AsciiJson([string]$Text) {
  $builder = [Text.StringBuilder]::new($Text.Length)
  foreach ($character in $Text.ToCharArray()) {
    $codePoint = [int][char]$character
    if ($codePoint -gt 0x7f) {
      [void]$builder.Append('\u')
      [void]$builder.Append($codePoint.ToString('x4'))
    } else {
      [void]$builder.Append($character)
    }
  }
  return $builder.ToString()
}

function Invoke-NativeCheck([string]$Name, [scriptblock]$Action) {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = 0
    $output = @(& $Action 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  $logPath = Join-Path $verificationLogRoot ("verification-$Name.log")
  [IO.File]::WriteAllLines($logPath, @($output | ForEach-Object { [string]$_ }), [Text.UTF8Encoding]::new($false))
  if ($exitCode -ne 0) { throw "master_verification_failed:$Name" }
  return [pscustomobject]@{ name = $Name; success = $true; log = Split-Path -Leaf $logPath }
}

function Invoke-MasterJson([string]$Url) {
  $temporary = Join-Path $env:TEMP ('retail-radar-master-check-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    & curl.exe --silent --show-error --fail --ssl-no-revoke --noproxy '*' `
      --cacert $MasterCaCertificatePath --output $temporary $Url
    if ($LASTEXITCODE -ne 0) { throw 'master_verification_api_failed' }
    return [IO.File]::ReadAllText($temporary, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Assert-SameIntegerSet([object[]]$Actual, [object[]]$Expected, [string]$Name) {
  $actualText = @($Actual | ForEach-Object { [int]$_ } | Sort-Object -Unique) -join ','
  $expectedText = @($Expected | ForEach-Object { [int]$_ } | Sort-Object -Unique) -join ','
  if ($actualText -ne $expectedText) { throw "master_verification_topology_mismatch:$Name" }
}

function Invoke-BoundedWorkerHostname([string]$Alias, [int]$TimeoutSeconds = 20) {
  $standardOutput = Join-Path $env:TEMP ('retail-radar-ssh-out-' + [guid]::NewGuid().ToString('N') + '.txt')
  $standardError = Join-Path $env:TEMP ('retail-radar-ssh-err-' + [guid]::NewGuid().ToString('N') + '.txt')
  $process = $null
  try {
    $arguments = @(
      '-n', '-T',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=5',
      '-o', 'ServerAliveCountMax=2',
      $Alias,
      'cmd.exe', '/d', '/s', '/c', 'hostname'
    )
    $process = Start-Process -FilePath 'ssh.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $standardOutput -RedirectStandardError $standardError
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit()
      throw "master_verification_worker_ssh_timeout:$Alias"
    }
    $process.WaitForExit()
    $hostnameLine = @(Get-Content -LiteralPath $standardOutput -Encoding UTF8 -ErrorAction SilentlyContinue) | Select-Object -First 1
    $hostname = if ($null -eq $hostnameLine) { '' } else { [string]$hostnameLine }
    $hostname = $hostname.Trim()
    if (-not $hostname) {
      $detail = (@(Get-Content -LiteralPath $standardError -Encoding UTF8 -ErrorAction SilentlyContinue) -join ' ')
      if ($detail.Length -gt 300) { $detail = $detail.Substring(0, 300) }
      throw "master_verification_worker_ssh_failed:${Alias}:$detail"
    }
    return $hostname
  } finally {
    foreach ($path in @($standardOutput, $standardError)) {
      if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
  }
}

if (-not (Test-Path -LiteralPath $WorkspaceRoot -PathType Container)) { throw 'master_verification_workspace_missing' }
if (-not (Test-Path -LiteralPath $MasterCaCertificatePath -PathType Leaf)) { throw 'master_verification_ca_missing' }
if (-not (Test-Path -LiteralPath $TopologyConfigPath -PathType Leaf)) { throw 'master_verification_topology_missing' }
Import-PrivateEnvironment $ConfigPath
$topology = Get-Content -LiteralPath $TopologyConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($topology.schemaVersion -ne 1 -or @($topology.activeWorkers).Count -eq 0) {
  throw 'master_verification_topology_invalid'
}

$publicBaseUrl = $env:MASTER_PUBLIC_BASE_URL
if (-not $publicBaseUrl -or -not $publicBaseUrl.StartsWith('https://')) { throw 'master_verification_public_url_invalid' }
$env:MASTER_BASE_URL = $publicBaseUrl.TrimEnd('/')
$env:DASHBOARD_BASE_URL = $publicBaseUrl.TrimEnd('/')
$env:REQUIRE_TLS = 'true'
$env:ALLOW_SELF_SIGNED_TLS = 'false'
$env:NODE_EXTRA_CA_CERTS = $MasterCaCertificatePath

Set-Location -LiteralPath $WorkspaceRoot
$verificationLogRoot = Join-Path (Split-Path -Parent $WorkspaceRoot) 'logs'
New-Item -ItemType Directory -Path $verificationLogRoot -Force | Out-Null
$results = @()
$results += Invoke-NativeCheck 'production_self_check' { pnpm production:self-check }
$results += Invoke-NativeCheck 'handoff_tests' { pnpm handoff:test }

foreach ($expected in @($topology.activeWorkers)) {
  $alias = [string]$expected.sshAlias
  if ($alias -notmatch '^[A-Za-z0-9._-]{1,128}$') { throw 'master_verification_worker_alias_invalid' }
  $hostname = Invoke-BoundedWorkerHostname $alias
  if ($hostname -ne [string]$expected.hostname) { throw "master_verification_worker_hostname_mismatch:$alias" }
  $results += [pscustomobject]@{ name = "ssh_$alias"; success = $true; hostname = $hostname }
}

$workersResponse = Invoke-MasterJson "$($publicBaseUrl.TrimEnd('/'))/api/workers"
foreach ($expected in @($topology.activeWorkers)) {
  $row = @($workersResponse.workers | Where-Object { $_.worker.workerId -eq [string]$expected.workerId } | Select-Object -First 1)
  if ($row.Count -ne 1) { throw "master_verification_worker_missing:$($expected.workerId)" }
  $worker = $row[0]
  if ($worker.worker.status -ne 'online') { throw "master_verification_worker_offline:$($expected.workerId)" }
  if ($worker.worker.agentVersion -ne [string]$expected.expectedVersion) { throw "master_verification_worker_version:$($expected.workerId)" }
  if ([int]$worker.execution.capture.concurrency -ne [int]$expected.captureConcurrency) { throw "master_verification_worker_concurrency:$($expected.workerId)" }
  if ([int]$worker.execution.capture.maxQueueSize -ne [int]$expected.captureQueueMax) { throw "master_verification_worker_queue:$($expected.workerId)" }
  Assert-SameIntegerSet @($worker.cdpEndpoints | ForEach-Object { $_.port }) @($expected.cdpPorts) "ports:$($expected.workerId)"
  foreach ($endpoint in @($worker.cdpEndpoints)) {
    if ($endpoint.status -in @('unknown', 'profile_risk', 'retired')) { throw "master_verification_cdp_unavailable:$($endpoint.port)" }
    if (-not $endpoint.lastSeenAt -or ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($endpoint.lastSeenAt)).TotalSeconds -gt 120) {
      throw "master_verification_cdp_stale:$($endpoint.port)"
    }
  }
  $results += [pscustomobject]@{
    name = "worker_$($expected.workerId)"
    success = $true
    label = $expected.label
    version = $worker.worker.agentVersion
    ports = @($worker.cdpEndpoints | Sort-Object port | ForEach-Object { $_.port })
  }
}

foreach ($excluded in @($topology.nonSchedulingWorkers)) {
  $row = @($workersResponse.workers | Where-Object { $_.worker.workerId -eq [string]$excluded.workerId } | Select-Object -First 1)
  if ($row.Count -eq 0) { continue }
  if (@($row[0].accounts).Count -gt 0 -or @($row[0].cdpEndpoints).Count -gt 0) {
    throw "master_verification_non_scheduling_worker_bound:$($excluded.workerId)"
  }
  $results += [pscustomobject]@{ name = "isolated_$($excluded.workerId)"; success = $true; label = $excluded.label }
}

if (-not $SkipRegistryDryRun) {
  $runner = Join-Path $WorkspaceRoot 'deploy\windows\run-registry-sync.ps1'
  $results += Invoke-NativeCheck 'registry_dry_run' {
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $runner `
      -WorkspaceRoot $WorkspaceRoot -ConfigPath $RegistryConfigPath -MasterCaCertificatePath $MasterCaCertificatePath
  }
}

# Native child processes can change the shared Windows console code page.
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$summary = [pscustomobject]@{
  success = $true
  checkedAt = (Get-Date).ToString('O')
  workspace = 'formal_app_snapshot'
  master = $publicBaseUrl
  checks = $results
}
$summaryJson = $summary | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText(
  (Join-Path $verificationLogRoot 'verification-summary-latest.json'),
  $summaryJson,
  [Text.UTF8Encoding]::new($false)
)
ConvertTo-AsciiJson $summaryJson
