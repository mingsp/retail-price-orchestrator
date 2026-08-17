[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9._-]{1,128}$')][string]$WorkerSshAlias,
  [Parameter(Mandatory = $true)][string]$MasterEnvironmentFile,
  [Parameter(Mandatory = $true)][string]$MasterUrl,
  [Parameter(Mandatory = $true)][string]$WorkerVersion,
  [Parameter(Mandatory = $true)][string]$MachineLabel,
  [Parameter(Mandatory = $true)][string]$ManifestUrl,
  [Parameter(Mandatory = $true)][string]$ReleasePublicKeyPath,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9._-]{1,64}$')][string]$ReleaseKeyId,
  [Parameter(Mandatory = $true)][string]$WinSWUrl,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$WinSWSha256,
  [Parameter(Mandatory = $true)][string]$MasterCaCertificatePath,
  [ValidateSet('none', 'rustdesk', 'rdp')][string]$RemoteDesktopProvider = 'none',
  [string]$RemoteDesktopTarget = ''
)

$ErrorActionPreference = 'Stop'

function Assert-HttpsUrl([string]$Value, [string]$Name) {
  $uri = [uri]$Value
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo) {
    throw "$Name must be an HTTPS URL without embedded credentials"
  }
}

function Invoke-RemotePowerShell([string]$Source) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Source))
  & ssh.exe -n -T -o BatchMode=yes -o ConnectTimeout=10 $WorkerSshAlias `
    cmd.exe /d /s /c powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded
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

Assert-HttpsUrl $MasterUrl 'MasterUrl'
Assert-HttpsUrl $ManifestUrl 'ManifestUrl'
Assert-HttpsUrl $WinSWUrl 'WinSWUrl'
foreach ($requiredFile in @($MasterEnvironmentFile, $ReleasePublicKeyPath, $MasterCaCertificatePath)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) { throw "Required file was not found: $requiredFile" }
}

$operatorLine = Get-Content -LiteralPath $MasterEnvironmentFile -Encoding UTF8 |
  Where-Object { $_.StartsWith('OPERATOR_TOKEN=') } | Select-Object -First 1
if (-not $operatorLine) { throw 'OPERATOR_TOKEN was not found in the Master environment file' }
$operatorToken = $operatorLine.Substring('OPERATOR_TOKEN='.Length)
if (-not $operatorToken) { throw 'OPERATOR_TOKEN is empty' }

$bootstrapRoot = 'C:\ProgramData\RetailRadar\bootstrap'
$remoteWindowsRoot = "$bootstrapRoot\windows"
$remoteReleaseRoot = "$bootstrapRoot\release"
$remoteCertificateRoot = "$bootstrapRoot\certificates"
$remoteSecretRoot = 'C:\ProgramData\RetailRadar\secrets'
$remoteTokenFile = "$remoteSecretRoot\worker-enrollment-$([guid]::NewGuid().ToString('N')).token"
$remoteTokenScpPath = $remoteTokenFile.Replace('\', '/')

$localSecretRoot = Join-Path $env:ProgramData 'RetailRadar\secrets'
New-Item -ItemType Directory -Force -Path $localSecretRoot | Out-Null
& icacls.exe $localSecretRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' "${env:USERNAME}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the Master secret directory' }
$localTokenFile = Join-Path $localSecretRoot (Split-Path -Leaf $remoteTokenFile)

$windowsFiles = @(
  'install-worker.ps1',
  'start-worker.ps1',
  'start-cdp-helper.ps1',
  'upgrade-worker.ps1',
  'retail-worker-service.xml'
)
$releaseFiles = @('verify-release-manifest.mjs', 'release-manifest-lib.mjs')

try {
  Invoke-RemotePowerShell @"
`$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path '$remoteWindowsRoot','$remoteReleaseRoot','$remoteCertificateRoot','$remoteSecretRoot' | Out-Null
& icacls.exe '$remoteSecretRoot' /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' "`${env:USERNAME}:(OI)(CI)F" | Out-Null
if (`$LASTEXITCODE -ne 0) { throw 'Failed to secure the Worker secret directory' }
"@

  foreach ($name in $windowsFiles) {
    & scp.exe -q (Join-Path $PSScriptRoot $name) "${WorkerSshAlias}:$($remoteWindowsRoot.Replace('\','/'))/$name"
    if ($LASTEXITCODE -ne 0) { throw "Failed to transfer $name" }
  }
  $releaseSourceRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'release'
  foreach ($name in $releaseFiles) {
    & scp.exe -q (Join-Path $releaseSourceRoot $name) "${WorkerSshAlias}:$($remoteReleaseRoot.Replace('\','/'))/$name"
    if ($LASTEXITCODE -ne 0) { throw "Failed to transfer $name" }
  }
  & scp.exe -q $ReleasePublicKeyPath "${WorkerSshAlias}:$($remoteCertificateRoot.Replace('\','/'))/worker-release-public.pem"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to transfer the release public key' }
  & scp.exe -q $MasterCaCertificatePath "${WorkerSshAlias}:$($remoteCertificateRoot.Replace('\','/'))/master-root.crt"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to transfer the Master CA certificate' }

  $body = @{ label = $MachineLabel; expiresInMinutes = 30; maxUses = 1 } | ConvertTo-Json -Compress
  $response = Invoke-RestMethod -Method Post -Uri "$($MasterUrl.TrimEnd('/'))/api/worker-enrollment-tokens" `
    -Headers @{ 'x-retail-operator-token' = $operatorToken } -ContentType 'application/json' -Body $body -TimeoutSec 20
  $enrollmentToken = [string]$response.enrollment.enrollmentToken
  if (-not $enrollmentToken) { throw 'Master did not return an enrollment token' }

  [IO.File]::WriteAllText($localTokenFile, $enrollmentToken, [Text.UTF8Encoding]::new($false))
  & icacls.exe $localTokenFile /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' "${env:USERNAME}:F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the enrollment token file' }
  & scp.exe -q $localTokenFile "${WorkerSshAlias}:$remoteTokenScpPath"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to transfer the enrollment token file' }

  $machineLabelBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($MachineLabel))
  Invoke-RemotePowerShell @"
`$ErrorActionPreference='Stop'
`$tokenFile='$remoteTokenFile'
& icacls.exe `$tokenFile /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' "`${env:USERNAME}:F" | Out-Null
if (`$LASTEXITCODE -ne 0) { throw 'Failed to secure the enrollment token file on Worker' }
& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '$remoteWindowsRoot\install-worker.ps1' -MasterUrl '$MasterUrl' -MasterVersion '$WorkerVersion' -EnrollmentTokenFile `$tokenFile -MachineLabel 'worker-bootstrap' -MachineLabelBase64 '$machineLabelBase64' -ManifestUrl '$ManifestUrl' -ReleasePublicKeyPath '$remoteCertificateRoot\worker-release-public.pem' -ReleaseKeyId '$ReleaseKeyId' -WinSWUrl '$WinSWUrl' -WinSWSha256 '$WinSWSha256' -MasterCaCertificatePath '$remoteCertificateRoot\master-root.crt' -RemoteDesktopProvider '$RemoteDesktopProvider' -RemoteDesktopTarget '$RemoteDesktopTarget'
if (`$LASTEXITCODE -ne 0) { throw "Worker installer failed with exit code `$LASTEXITCODE" }
"@
} finally {
  $operatorToken = $null
  $enrollmentToken = $null
  Remove-SecretFile $localTokenFile
  $cleanup = @"
`$path='$remoteTokenFile'
if (Test-Path -LiteralPath `$path -PathType Leaf) {
  `$random=New-Object byte[] ([Math]::Max(64,(Get-Item -LiteralPath `$path).Length))
  `$generator=[Security.Cryptography.RandomNumberGenerator]::Create()
  try { `$generator.GetBytes(`$random) } finally { `$generator.Dispose() }
  [IO.File]::WriteAllBytes(`$path,`$random)
  Remove-Item -LiteralPath `$path -Force
}
"@
  try { Invoke-RemotePowerShell $cleanup } catch { Write-Warning $_.Exception.Message }
}
