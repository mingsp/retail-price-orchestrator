$ErrorActionPreference = "Stop"
$InstallRoot = Split-Path -Parent $PSScriptRoot
$EnvironmentFile = Join-Path $InstallRoot "config\worker.env"
$CurrentRelease = Join-Path $InstallRoot "current"

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "Worker environment file is missing: $EnvironmentFile" }
if (-not (Test-Path -LiteralPath (Join-Path $CurrentRelease "dist\index.js") -PathType Leaf)) { throw "Active Worker release is invalid: $CurrentRelease" }

Get-Content -LiteralPath $EnvironmentFile -Encoding UTF8 | ForEach-Object {
  if ($_ -and -not $_.StartsWith("#")) {
    $name, $value = $_ -split "=", 2
    if ($name -and $null -ne $value) { [Environment]::SetEnvironmentVariable($name.Trim(), $value, "Process") }
  }
}

$env:WORKER_RUNTIME_ROLE = "cdp_helper"
$env:WORKER_ENABLE_TASK_POLLING = "false"
$env:WORKER_ENABLE_TASK_EXECUTION = "false"
$env:WORKER_ENABLE_CDP_COMMANDS = "true"

Set-Location -LiteralPath $CurrentRelease
& (Get-Command node -ErrorAction Stop).Source "dist\index.js"
exit $LASTEXITCODE
