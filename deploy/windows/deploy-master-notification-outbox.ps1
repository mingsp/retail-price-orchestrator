[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9._-]+$')][string]$Version,
  [Parameter(Mandatory = $true)][string]$StagingRoot,
  [string]$WorkspaceRoot = 'D:\SpanAI\retail-radar-master\workspace\retail-price-orchestrator',
  [string]$RuntimeRoot = 'D:\SpanAI\retail-radar-master',
  [string]$RegistryTaskName = 'RetailRadar-DingTalkRegistry-DryRun'
)

$ErrorActionPreference = 'Stop'
$image = "retail-radar-master:$Version"
$buildContainer = "retail-radar-master-build-$($Version -replace '[^A-Za-z0-9_.-]', '-')"
$canaryContainer = 'retail-radar-master-notification-canary'
$backupRoot = Join-Path $RuntimeRoot ("backups\registry-notification-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$canaryEnvironmentPath = Join-Path $RuntimeRoot 'config\notification-canary.env'
$cutoverScript = Join-Path $WorkspaceRoot 'deploy\windows\cutover-master-registry.ps1'
$task = Get-ScheduledTask -TaskName $RegistryTaskName -ErrorAction SilentlyContinue
$taskWasEnabled = $task -and $task.State -ne 'Disabled'
$chromeBefore = @(Get-Process chrome -ErrorAction SilentlyContinue).Count
$currentContainer = (docker inspect retail-radar-master-1 | ConvertFrom-Json)[0]
$oldImage = $currentContainer.Config.Image
$masterNetwork = $currentContainer.HostConfig.NetworkMode
if ([string]::IsNullOrWhiteSpace($masterNetwork)) { throw 'master_network_missing' }
$completed = $false

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { throw "staging_path_missing:$Source" }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force
}

function Remove-ContainerIfExists([string]$Name) {
  $id = docker ps -aq --filter "name=^/$Name$" | Select-Object -First 1
  if ($id) { docker rm -f $Name | Out-Null }
}

try {
  if ($taskWasEnabled) { Disable-ScheduledTask -TaskName $RegistryTaskName | Out-Null }

  New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $WorkspaceRoot 'apps\master\dist') -Destination (Join-Path $backupRoot 'master-dist') -Recurse
  Copy-Item -LiteralPath (Join-Path $WorkspaceRoot 'apps\master\src') -Destination (Join-Path $backupRoot 'master-src') -Recurse
  Copy-Item -LiteralPath (Join-Path $WorkspaceRoot 'apps\master\test') -Destination (Join-Path $backupRoot 'master-test') -Recurse
  Copy-Item -LiteralPath (Join-Path $WorkspaceRoot 'apps\registry-sync') -Destination (Join-Path $backupRoot 'registry-sync') -Recurse
  Copy-Item -LiteralPath (Join-Path $WorkspaceRoot 'deploy\windows\run-registry-sync.ps1') -Destination (Join-Path $backupRoot 'run-registry-sync.ps1')

  Copy-DirectoryContents (Join-Path $StagingRoot 'apps\master\dist') (Join-Path $WorkspaceRoot 'apps\master\dist')
  Copy-DirectoryContents (Join-Path $StagingRoot 'apps\master\src') (Join-Path $WorkspaceRoot 'apps\master\src')
  Copy-DirectoryContents (Join-Path $StagingRoot 'apps\master\test') (Join-Path $WorkspaceRoot 'apps\master\test')
  Copy-DirectoryContents (Join-Path $StagingRoot 'apps\registry-sync\src') (Join-Path $WorkspaceRoot 'apps\registry-sync\src')
  Copy-DirectoryContents (Join-Path $StagingRoot 'apps\registry-sync\test') (Join-Path $WorkspaceRoot 'apps\registry-sync\test')
  Copy-Item -LiteralPath (Join-Path $StagingRoot 'apps\registry-sync\package.json') -Destination (Join-Path $WorkspaceRoot 'apps\registry-sync\package.json') -Force
  Copy-Item -LiteralPath (Join-Path $StagingRoot 'deploy\windows\run-registry-sync.ps1') -Destination (Join-Path $WorkspaceRoot 'deploy\windows\run-registry-sync.ps1') -Force

  Remove-ContainerIfExists $buildContainer
  Remove-ContainerIfExists $canaryContainer
  docker create --name $buildContainer $oldImage | Out-Null
  docker cp "$(Join-Path $StagingRoot 'apps\master\dist')\." "${buildContainer}:/app/apps/master/dist"
  if ($LASTEXITCODE -ne 0) { throw 'master_dist_copy_failed' }
  docker commit $buildContainer $image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'master_image_commit_failed' }
  docker rm $buildContainer | Out-Null

  $canaryEnvironment = @($currentContainer.Config.Env | Where-Object { $_ -notmatch '^MASTER_PORT=' }) + 'MASTER_PORT=3000'
  [IO.File]::WriteAllLines($canaryEnvironmentPath, $canaryEnvironment, [Text.UTF8Encoding]::new($false))
  & icacls.exe $canaryEnvironmentPath /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' "$env:USERNAME`:F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'canary_environment_acl_failed' }
  docker run -d --name $canaryContainer --network $masterNetwork --env-file $canaryEnvironmentPath $image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'master_canary_start_failed' }
  $canaryReady = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Seconds 2
    docker exec $canaryContainer node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>$null
    if ($LASTEXITCODE -eq 0) { $canaryReady = $true; break }
  }
  if (-not $canaryReady) {
    docker logs --tail 100 $canaryContainer
    throw 'master_canary_not_ready'
  }
  Remove-ContainerIfExists $canaryContainer

  & $cutoverScript -Version $Version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'master_cutover_failed' }
  $completed = $true

  [pscustomobject]@{
    success = $true
    backupRoot = $backupRoot
    oldImage = $oldImage
    newImage = (docker inspect retail-radar-master-1 | ConvertFrom-Json)[0].Config.Image
    chromeBefore = $chromeBefore
    chromeAfter = @(Get-Process chrome -ErrorAction SilentlyContinue).Count
  } | ConvertTo-Json -Compress
} finally {
  Remove-ContainerIfExists $buildContainer
  Remove-ContainerIfExists $canaryContainer
  if (Test-Path -LiteralPath $canaryEnvironmentPath) { Remove-Item -LiteralPath $canaryEnvironmentPath -Force }
  if (-not $completed -and (Test-Path -LiteralPath $backupRoot)) {
    Copy-DirectoryContents (Join-Path $backupRoot 'master-dist') (Join-Path $WorkspaceRoot 'apps\master\dist')
    Copy-DirectoryContents (Join-Path $backupRoot 'master-src') (Join-Path $WorkspaceRoot 'apps\master\src')
    Copy-DirectoryContents (Join-Path $backupRoot 'master-test') (Join-Path $WorkspaceRoot 'apps\master\test')
    Copy-DirectoryContents (Join-Path $backupRoot 'registry-sync') (Join-Path $WorkspaceRoot 'apps\registry-sync')
    Copy-Item -LiteralPath (Join-Path $backupRoot 'run-registry-sync.ps1') -Destination (Join-Path $WorkspaceRoot 'deploy\windows\run-registry-sync.ps1') -Force
  }
  if ($taskWasEnabled) { Enable-ScheduledTask -TaskName $RegistryTaskName | Out-Null }
}
