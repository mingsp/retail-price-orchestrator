[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string[]]$WorkerSshAlias,

    [Parameter(Mandatory = $true)]
    [string]$ManifestUrl,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$ExpectedSha256,

    [ValidateRange(15, 300)]
    [int]$SshTimeoutSeconds = 45
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$manifestUri = [uri]$ManifestUrl
if (-not $manifestUri.IsAbsoluteUri -or $manifestUri.Scheme -ne 'https' -or $manifestUri.UserInfo) {
    throw 'ManifestUrl must be an HTTPS URL without embedded credentials'
}

$urlBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ManifestUrl))
$expectedHash = $ExpectedSha256.ToLowerInvariant()
$remoteScript = @"
`$ProgressPreference = 'SilentlyContinue'
`$ErrorActionPreference = 'Stop'
`$url = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$urlBase64'))
`$temporary = Join-Path `$env:TEMP ('retail-radar-manifest-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    Invoke-WebRequest -UseBasicParsing -Proxy `$null -Uri `$url -OutFile `$temporary -TimeoutSec 30
    [pscustomobject]@{
        computer = `$env:COMPUTERNAME
        size = (Get-Item -LiteralPath `$temporary).Length
        sha256 = (Get-FileHash -LiteralPath `$temporary -Algorithm SHA256).Hash.ToLowerInvariant()
    } | ConvertTo-Json -Compress
}
finally {
    if (Test-Path -LiteralPath `$temporary) { Remove-Item -LiteralPath `$temporary -Force }
}
"@
$encodedRemoteScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))

function Invoke-BoundedSshProbe([string]$Alias, [string]$EncodedScript) {
    $standardOutput = Join-Path $env:TEMP ('retail-radar-ssh-out-' + [guid]::NewGuid().ToString('N') + '.txt')
    $standardError = Join-Path $env:TEMP ('retail-radar-ssh-err-' + [guid]::NewGuid().ToString('N') + '.txt')
    $process = $null
    try {
        $arguments = @(
            '-n',
            '-T',
            '-o', 'BatchMode=yes',
            '-o', 'ConnectTimeout=10',
            '-o', 'ServerAliveInterval=5',
            '-o', 'ServerAliveCountMax=2',
            $Alias,
            'cmd.exe', '/d', '/s', '/c',
            'powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', $EncodedScript
        )
        $process = Start-Process -FilePath 'ssh.exe' `
            -ArgumentList $arguments `
            -WindowStyle Hidden `
            -PassThru `
            -RedirectStandardOutput $standardOutput `
            -RedirectStandardError $standardError
        if (-not $process.WaitForExit($SshTimeoutSeconds * 1000)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            $process.WaitForExit()
            throw "Release access test timed out for $Alias after $SshTimeoutSeconds seconds"
        }
        $process.WaitForExit()
        $process.Refresh()
        $output = @(Get-Content -LiteralPath $standardOutput -Encoding UTF8 -ErrorAction SilentlyContinue)
        $errorText = @(Get-Content -LiteralPath $standardError -Encoding UTF8 -ErrorAction SilentlyContinue) -join ' '
        return [pscustomobject]@{
            output = $output
            error = $errorText
        }
    }
    finally {
        foreach ($path in @($standardOutput, $standardError)) {
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        }
    }
}

$results = @()
foreach ($alias in $WorkerSshAlias) {
    if ($alias -notmatch '^[A-Za-z0-9._-]{1,128}$') {
        throw "Invalid SSH alias: $alias"
    }

    $probe = Invoke-BoundedSshProbe -Alias $alias -EncodedScript $encodedRemoteScript
    $output = @($probe.output)
    $jsonLine = @($output | Where-Object { $_ -match '^\{' } | Select-Object -First 1)
    if ($jsonLine.Count -ne 1) {
        $detail = if ($probe.error) { [string]$probe.error } else { 'no JSON response' }
        if ($detail.Length -gt 500) { $detail = $detail.Substring(0, 500) }
        throw "Release access result is missing for ${alias}: $detail"
    }
    $result = $jsonLine[0] | ConvertFrom-Json
    if ([string]$result.sha256 -ne $expectedHash) {
        throw "Manifest hash mismatch for $alias"
    }
    $results += [pscustomobject]@{
        alias = $alias
        computer = $result.computer
        size = $result.size
        sha256 = $result.sha256
    }
}

$results | ConvertTo-Json -Compress
