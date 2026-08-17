$ErrorActionPreference = "Stop"

$installRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot "start-retail-radar-cdps.ps1"
$config = Join-Path $installRoot "config\cdp-profiles.json"
$logDirectory = Join-Path $installRoot "logs"
$log = Join-Path $logDirectory "cdp-start.log"

[void](New-Item -ItemType Directory -Force -Path $logDirectory)

try {
    & $launcher -ConfigPath $config 2>&1 |
        Tee-Object -FilePath $log
}
catch {
    $_ | Out-String | Set-Content -LiteralPath $log -Encoding UTF8
    throw
}
