[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SampleSourceRoot,

  [string]$ReleaseName = ("retail-price-orchestrator-handoff-{0}" -f (Get-Date -Format 'yyyyMMdd')),

  [string]$PackageVersion = ("{0}.1" -f (Get-Date -Format 'yyyy.MM.dd')),

  [string]$SourceValidation = ""
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptRoot "..\..")).Path
$releaseRoot = Join-Path $repoRoot "handoff\releases"
$releaseDirectory = Join-Path $releaseRoot $ReleaseName
$zipPath = "$releaseDirectory.zip"
$shaPath = "$zipPath.sha256"

$arguments = @(
  (Join-Path $scriptRoot "build-package.mjs"),
  "--sample-source-root",
  $SampleSourceRoot,
  "--release-name",
  $ReleaseName,
  "--package-version",
  $PackageVersion
)
if ($SourceValidation) {
  $arguments += @("--source-validation", $SourceValidation)
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
  throw "Node package build failed with exit code $LASTEXITCODE"
}

$resolvedReleaseRoot = [System.IO.Path]::GetFullPath($releaseRoot)
$resolvedReleaseDirectory = [System.IO.Path]::GetFullPath($releaseDirectory)
if ([System.IO.Path]::GetDirectoryName($resolvedReleaseDirectory) -ne $resolvedReleaseRoot) {
  throw "Unsafe release directory: $resolvedReleaseDirectory"
}

foreach ($target in @($zipPath, $shaPath)) {
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Force
  }
}

Compress-Archive -LiteralPath $releaseDirectory -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([System.IO.Path]::GetFileName($zipPath))" |
  Set-Content -LiteralPath $shaPath -Encoding utf8

[ordered]@{
  status = "pass"
  releaseDirectory = $releaseDirectory
  zipPath = $zipPath
  sha256 = $hash
  sha256File = $shaPath
} | ConvertTo-Json -Depth 4
