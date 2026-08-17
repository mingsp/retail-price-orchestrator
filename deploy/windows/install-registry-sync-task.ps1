[CmdletBinding()]
param(
  [string]$TaskName = 'RetailRadar-DingTalkRegistry-DryRun',
  [string]$WorkspaceRoot = 'D:\SpanAI\retail-radar-master\app',
  [string]$ConfigPath = 'D:\SpanAI\retail-radar-master\config\registry-sync.env',
  [string]$LogRoot = 'D:\SpanAI\retail-radar-master\logs'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'registry_sync_task_requires_administrator'
}
foreach ($path in @($WorkspaceRoot, $ConfigPath)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "registry_sync_required_path_missing:$path" }
}

$runner = Join-Path $WorkspaceRoot 'deploy\windows\run-registry-sync.ps1'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'registry_sync_runner_missing' }
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
$arguments = @(
  '-NoProfile',
  '-WindowStyle', 'Hidden',
  '-ExecutionPolicy', 'Bypass',
  '-File', "`"$runner`"",
  '-WorkspaceRoot', "`"$WorkspaceRoot`"",
  '-ConfigPath', "`"$ConfigPath`"",
  '-LogRoot', "`"$LogRoot`""
) -join ' '
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 4) `
  -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
[pscustomobject]@{
  TaskName = $TaskName
  State = [string](Get-ScheduledTask -TaskName $TaskName).State
  Mode = 'dry_run'
  IntervalMinutes = 5
  WorkspaceRoot = $WorkspaceRoot
  LogRoot = $LogRoot
} | ConvertTo-Json -Compress
