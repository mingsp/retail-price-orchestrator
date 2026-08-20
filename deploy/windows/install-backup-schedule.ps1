[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [Parameter(Mandatory = $true)][string]$PolicyPath,
  [string]$RunnerPath = '',
  [string]$DailyTaskName = 'RetailRadar-Master-DailyBackup',
  [string]$WeeklyTaskName = 'RetailRadar-Master-WeeklyRestoreDrill',
  [string]$DailyAt = '03:00',
  [string]$WeeklyAt = '04:00'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runner = if ($RunnerPath) { $RunnerPath } else { Join-Path $InstallRoot 'app\deploy\windows\invoke-scheduled-backup.ps1' }
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'Scheduled backup runner was not found' }
$resolvedPolicy = (Resolve-Path -LiteralPath $PolicyPath).Path
$resolvedRunner = (Resolve-Path -LiteralPath $runner).Path

$dailyAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$resolvedRunner`" -PolicyPath `"$resolvedPolicy`""
$weeklyAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$resolvedRunner`" -PolicyPath `"$resolvedPolicy`" -RunRestoreDrill"
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $WeeklyAt
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $DailyTaskName -Action $dailyAction -Trigger $dailyTrigger -Settings $settings -Principal $principal -Force | Out-Null
Register-ScheduledTask -TaskName $WeeklyTaskName -Action $weeklyAction -Trigger $weeklyTrigger -Settings $settings -Principal $principal -Force | Out-Null

[pscustomobject]@{
  DailyTask = $DailyTaskName
  WeeklyTask = $WeeklyTaskName
  PolicyPath = $resolvedPolicy
} | ConvertTo-Json -Compress
