[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$MachineLabelBase64,

    [string]$InstallRoot = "$env:ProgramData\RetailRadar\Worker"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
    $label = [Text.UTF8Encoding]::new($false, $true).GetString(
        [Convert]::FromBase64String($MachineLabelBase64)
    ).Trim()
}
catch {
    throw 'MachineLabelBase64 must contain valid UTF-8'
}
if (-not $label) { throw 'MachineLabelBase64 decoded to an empty label' }

$environmentPath = Join-Path $InstallRoot 'config\worker.env'
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
    throw "Worker environment file is missing: $environmentPath"
}

$backupPath = "$environmentPath.label-bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $environmentPath -Destination $backupPath

$lines = [Collections.Generic.List[string]]@(
    Get-Content -LiteralPath $environmentPath -Encoding UTF8
)
$values = [ordered]@{
    WORKER_MACHINE_LABEL = $label
    WORKER_MACHINE_LABEL_BASE64 = $MachineLabelBase64
}
foreach ($entry in $values.GetEnumerator()) {
    $prefix = "$($entry.Key)="
    $found = $false
    for ($index = 0; $index -lt $lines.Count; $index += 1) {
        if ($lines[$index].StartsWith($prefix)) {
            $lines[$index] = "$prefix$($entry.Value)"
            $found = $true
            break
        }
    }
    if (-not $found) { $lines.Add("$prefix$($entry.Value)") }
}

[IO.File]::WriteAllLines(
    $environmentPath,
    $lines,
    [Text.UTF8Encoding]::new($false)
)

[pscustomobject]@{
    computer = $env:COMPUTERNAME
    label = $label
    backup = $backupPath
} | ConvertTo-Json -Compress
