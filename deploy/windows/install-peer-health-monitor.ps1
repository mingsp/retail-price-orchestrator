[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [Parameter(Mandatory = $true)][string]$PolicyPath,
  [string]$TaskName = 'RetailRadar-Peer-HealthMonitor'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$runner = (Resolve-Path -LiteralPath (Join-Path $InstallRoot 'app\deploy\windows\invoke-peer-health-monitor.ps1')).Path
$policy = (Resolve-Path -LiteralPath $PolicyPath).Path
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -PolicyPath `"$policy`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
[pscustomobject]@{ TaskName = $TaskName; PolicyPath = $policy } | ConvertTo-Json -Compress
