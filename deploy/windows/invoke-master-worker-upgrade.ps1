[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9._-]{1,128}$")][string]$WorkerSshAlias,
  [Parameter(Mandatory = $true)][string]$MasterEnvironmentFile,
  [Parameter(Mandatory = $true)][string]$ManifestUrl,
  [Parameter(Mandatory = $true)][string]$MasterUrl,
  [Parameter(Mandatory = $true)][string]$CurrentMasterVersion,
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9._-]{1,64}$")][string]$ReleaseKeyId
)

$ErrorActionPreference = "Stop"

function Assert-HttpsUrl([string]$Value, [string]$Name) {
  $uri = [uri]$Value
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https" -or $uri.UserInfo) {
    throw "$Name must be an HTTPS URL without embedded credentials"
  }
}

function Invoke-RemotePowerShell([string]$Source) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Source))
  & ssh.exe -n -T -o BatchMode=yes -o ConnectTimeout=10 $WorkerSshAlias `
    cmd.exe /d /s /c powershell.exe -NoProfile -NonInteractive -EncodedCommand $encoded
  if ($LASTEXITCODE -ne 0) { throw "Remote PowerShell failed with exit code $LASTEXITCODE" }
}

function Remove-SecretFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  $random = New-Object byte[] ([Math]::Max(64, (Get-Item -LiteralPath $Path).Length))
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($random) } finally { $generator.Dispose() }
  [IO.File]::WriteAllBytes($Path, $random)
  Remove-Item -LiteralPath $Path -Force
}

Assert-HttpsUrl $ManifestUrl "ManifestUrl"
Assert-HttpsUrl $MasterUrl "MasterUrl"
if (-not (Test-Path -LiteralPath $MasterEnvironmentFile -PathType Leaf)) { throw "Master environment file was not found" }
$workerUpgradeEntrySource = Join-Path $PSScriptRoot "invoke-worker-upgrade-from-stdin.ps1"
$workerUpgradeScriptSource = Join-Path $PSScriptRoot "upgrade-worker.ps1"
foreach ($source in @($workerUpgradeEntrySource, $workerUpgradeScriptSource)) {
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Worker upgrade tooling was not found: $source" }
}

$tokenLine = Get-Content -LiteralPath $MasterEnvironmentFile -Encoding UTF8 |
  Where-Object { $_.StartsWith("AUTOMATION_TOKEN=") } | Select-Object -First 1
if (-not $tokenLine) { throw "AUTOMATION_TOKEN was not found in the Master environment file" }
$token = $tokenLine.Substring("AUTOMATION_TOKEN=".Length)
if (-not $token) { throw "AUTOMATION_TOKEN is empty" }

$secretRoot = Join-Path $env:ProgramData "RetailRadar\secrets"
New-Item -ItemType Directory -Path $secretRoot -Force | Out-Null
& icacls.exe $secretRoot /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "${env:USERNAME}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to secure the Master secret directory" }

$name = "worker-upgrade-$([guid]::NewGuid().ToString('N')).token"
$localTokenFile = Join-Path $secretRoot $name
$remoteTokenFile = "C:\ProgramData\RetailRadar\secrets\$name"
$remoteTokenScpPath = "C:/ProgramData/RetailRadar/secrets/$name"
$remoteUpgradeEntryScpPath = "C:/ProgramData/RetailRadar/bootstrap/windows/invoke-worker-upgrade-from-stdin.ps1"
$remoteUpgradeScriptScpPath = "C:/ProgramData/RetailRadar/Worker/service/upgrade-worker.ps1"
[IO.File]::WriteAllText($localTokenFile, $token, [Text.UTF8Encoding]::new($false))
& icacls.exe $localTokenFile /inheritance:r /grant:r "SYSTEM:F" "BUILTIN\Administrators:F" "${env:USERNAME}:F" | Out-Null
if ($LASTEXITCODE -ne 0) { Remove-SecretFile $localTokenFile; throw "Failed to secure the Master token file" }

try {
  Invoke-RemotePowerShell @'
$root = 'C:\ProgramData\RetailRadar\secrets'
New-Item -ItemType Directory -Path $root -Force | Out-Null
New-Item -ItemType Directory -Path 'C:\ProgramData\RetailRadar\bootstrap\windows' -Force | Out-Null
New-Item -ItemType Directory -Path 'C:\ProgramData\RetailRadar\Worker\service' -Force | Out-Null
& icacls.exe $root /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' "${env:USERNAME}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the Worker secret directory' }
'@
  & scp.exe -q $workerUpgradeEntrySource "${WorkerSshAlias}:$remoteUpgradeEntryScpPath"
  if ($LASTEXITCODE -ne 0) { throw "Worker upgrade entry transfer failed with exit code $LASTEXITCODE" }
  & scp.exe -q $workerUpgradeScriptSource "${WorkerSshAlias}:$remoteUpgradeScriptScpPath"
  if ($LASTEXITCODE -ne 0) { throw "Worker upgrade script transfer failed with exit code $LASTEXITCODE" }
  & scp.exe -q $localTokenFile "${WorkerSshAlias}:$remoteTokenScpPath"
  if ($LASTEXITCODE -ne 0) { throw "Token transfer failed with exit code $LASTEXITCODE" }

  $remoteUpgrade = @"
`$tokenFile='$remoteTokenFile'
& icacls.exe `$tokenFile /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' "`${env:USERNAME}:F" | Out-Null
if (`$LASTEXITCODE -ne 0) { throw 'Failed to secure the Worker token file' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\ProgramData\RetailRadar\bootstrap\windows\invoke-worker-upgrade-from-stdin.ps1' -ManifestUrl '$ManifestUrl' -MasterUrl '$MasterUrl' -CurrentMasterVersion '$CurrentMasterVersion' -ReleasePublicKeyPath 'C:\ProgramData\RetailRadar\Worker\certificates\release-signing-public.pem' -ReleaseKeyId '$ReleaseKeyId' -AutomationTokenFile `$tokenFile
if (`$LASTEXITCODE -ne 0) { throw "Worker upgrade entry failed with exit code `$LASTEXITCODE" }
"@
  Invoke-RemotePowerShell $remoteUpgrade
} finally {
  $token = $null
  Remove-SecretFile $localTokenFile
  $remoteCleanup = @"
`$path='$remoteTokenFile'
if (Test-Path -LiteralPath `$path -PathType Leaf) {
  `$random=New-Object byte[] ([Math]::Max(64,(Get-Item -LiteralPath `$path).Length))
  `$generator=[Security.Cryptography.RandomNumberGenerator]::Create()
  try { `$generator.GetBytes(`$random) } finally { `$generator.Dispose() }
  [IO.File]::WriteAllBytes(`$path,`$random)
  Remove-Item -LiteralPath `$path -Force
}
"@
  try { Invoke-RemotePowerShell $remoteCleanup } catch { Write-Warning $_.Exception.Message }
}
