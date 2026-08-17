param(
  [Parameter(Mandatory = $true)]
  [string]$ProductionEnvPath,
  [Parameter(Mandatory = $true)]
  [string]$OutputConfigPath,
  [string]$TemplatePath = (Join-Path $PSScriptRoot "..\..\infra\alertmanager\alertmanager.template.yml")
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'windows-acl.ps1')

function Read-EnvMap {
  param([string]$Path)
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $name, $value = $line -split '=', 2
    $values[$name.Trim()] = $value.Trim()
  }
  return $values
}

function New-UrlSafeSecret {
  $bytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) }
  finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Protect-SecretFile {
  param([string]$Path)
  Protect-RetailRadarPath -Path $Path
}

function Set-EnvValue {
  param([string]$Path, [string]$Name, [string]$Value)
  $lines = [Collections.Generic.List[string]](Get-Content -LiteralPath $Path)
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match ('^' + [regex]::Escape($Name) + '=')) {
      if (-not $found) {
        $lines[$index] = "$Name=$Value"
        $found = $true
      } else {
        $lines.RemoveAt($index)
        $index--
      }
    }
  }
  if (-not $found) { $lines.Add("$Name=$Value") }
  $lines | Set-Content -LiteralPath $Path -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $ProductionEnvPath)) { throw "Production env file not found" }
if (-not (Test-Path -LiteralPath $TemplatePath)) { throw "Alertmanager template not found" }

$envMap = Read-EnvMap -Path $ProductionEnvPath
$token = $envMap['MONITORING_ALERT_TOKEN']
if ([string]::IsNullOrWhiteSpace($token)) {
  $token = New-UrlSafeSecret
  Set-EnvValue -Path $ProductionEnvPath -Name 'MONITORING_ALERT_TOKEN' -Value $token
}

$outputDirectory = Split-Path -Parent $OutputConfigPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$rendered = (Get-Content -LiteralPath $TemplatePath -Raw).Replace('__MONITORING_ALERT_TOKEN__', $token)
if ($rendered -match '__MONITORING_ALERT_TOKEN__') { throw "Alertmanager token rendering failed" }
$rendered | Set-Content -LiteralPath $OutputConfigPath -Encoding UTF8
Protect-SecretFile -Path $OutputConfigPath

$normalizedOutput = (Resolve-Path -LiteralPath $OutputConfigPath).Path
Set-EnvValue -Path $ProductionEnvPath -Name 'ALERTMANAGER_CONFIG_PATH' -Value $normalizedOutput

[pscustomobject]@{
  Configured = $true
  ConfigPath = $normalizedOutput
  TokenPresent = $true
} | ConvertTo-Json -Compress
