[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ManifestUrl,
  [Parameter(Mandatory = $true)][string]$MasterUrl,
  [Parameter(Mandatory = $true)][string]$CurrentMasterVersion,
  [Parameter(Mandatory = $true)][string]$ReleasePublicKeyPath,
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9._-]{1,64}$")][string]$ReleaseKeyId,
  [Parameter(Mandatory = $true)][string]$AutomationTokenFile,
  [string]$InstallRoot = "$env:ProgramData\RetailRadar\Worker"
)

$ErrorActionPreference = "Stop"
$resolvedTokenFile = [IO.Path]::GetFullPath($AutomationTokenFile)
$allowedTokenRoot = [IO.Path]::GetFullPath((Join-Path $env:ProgramData "RetailRadar")).TrimEnd("\") + "\"
if (-not $resolvedTokenFile.StartsWith($allowedTokenRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "AutomationTokenFile must be inside the managed RetailRadar ProgramData root"
}
if (-not (Test-Path -LiteralPath $resolvedTokenFile -PathType Leaf)) { throw "Automation token file was not found" }
$token = (Get-Content -Raw -LiteralPath $resolvedTokenFile -Encoding UTF8).Trim()
if (-not $token) { throw "Automation token file was empty" }
$random = New-Object byte[] ([Math]::Max(64, (Get-Item -LiteralPath $resolvedTokenFile).Length))
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $generator.GetBytes($random) } finally { $generator.Dispose() }
[IO.File]::WriteAllBytes($resolvedTokenFile, $random)
Remove-Item -LiteralPath $resolvedTokenFile -Force

$environmentFile = Join-Path $InstallRoot "config\worker.env"
$upgradeScript = Join-Path $InstallRoot "service\upgrade-worker.ps1"
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) { throw "Worker environment file was not found" }
if (-not (Test-Path -LiteralPath $upgradeScript -PathType Leaf)) { throw "Worker upgrade script was not found" }

$backup = "$environmentFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $environmentFile -Destination $backup -Force

$lines = @(Get-Content -LiteralPath $environmentFile -Encoding UTF8)
$plainLabel = $lines | Where-Object { $_.StartsWith("WORKER_MACHINE_LABEL=") } | Select-Object -First 1
if (-not $plainLabel) { throw "WORKER_MACHINE_LABEL is missing" }
$existingEncodedLine = $lines | Where-Object { $_.StartsWith("WORKER_MACHINE_LABEL_BASE64=") } | Select-Object -First 1
if ($existingEncodedLine) {
  $updated = $lines
} else {
  $label = $plainLabel.Substring("WORKER_MACHINE_LABEL=".Length)
  $encodedLabel = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($label))
  $encodedLine = "WORKER_MACHINE_LABEL_BASE64=$encodedLabel"
  $withEncodedLabel = New-Object System.Collections.Generic.List[string]
  foreach ($line in $lines) {
    $withEncodedLabel.Add($line)
    if ($line.StartsWith("WORKER_MACHINE_LABEL=")) { $withEncodedLabel.Add($encodedLine) }
  }
  $updated = $withEncodedLabel.ToArray()
}
[IO.File]::WriteAllLines($environmentFile, [string[]]$updated, [Text.UTF8Encoding]::new($false))

try {
  & $upgradeScript -ManifestUrl $ManifestUrl -MasterUrl $MasterUrl `
    -CurrentMasterVersion $CurrentMasterVersion -ReleasePublicKeyPath $ReleasePublicKeyPath `
    -ReleaseKeyId $ReleaseKeyId -AutomationToken $token -InstallRoot $InstallRoot
} finally {
  $token = $null
}

$release = Get-Content -Raw -LiteralPath (Join-Path $InstallRoot "current\package.json") -Encoding UTF8 | ConvertFrom-Json
[pscustomobject]@{
  configBackup = $backup
  version = [string]$release.version
  service = (Get-Service RetailRadarWorker).Status.ToString()
} | ConvertTo-Json -Compress
