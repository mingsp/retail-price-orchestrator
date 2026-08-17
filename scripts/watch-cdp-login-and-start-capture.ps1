[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath
)

$ErrorActionPreference = "Stop"

function Emit-Event {
    param([string]$Event, [object]$Data)

    [pscustomobject]@{
        ts = (Get-Date).ToString("s")
        event = $Event
        data = $Data
    } | ConvertTo-Json -Depth 8 -Compress
    [Console]::Out.Flush()
}

function Get-SlotFiles {
    param([object]$Config, [object]$Slot)

    $captureId = "{0}-slot{1:D2}" -f $Config.capturePrefix, [int]$Slot.slot
    $outputDir = Join-Path $Config.runRoot ("slot{0:D2}" -f [int]$Slot.slot)
    return [pscustomobject]@{
        captureId = $captureId
        outputDir = $outputDir
        progress = Join-Path $outputDir "$captureId.progress.jsonl"
        summary = Join-Path $outputDir "$captureId.summary.json"
        pid = Join-Path $outputDir "$captureId.pid"
    }
}

function Get-CdpPages {
    param([int]$LocalPort)

    return @(
        Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/json/list" -TimeoutSec 4 |
            Where-Object {
                $_.type -eq "page" -and
                $_.url -notlike "data:text/html*" -and
                $_.url -notlike "devtools://*" -and
                $_.url -ne "about:blank"
            }
    )
}

function Start-Capture {
    param([object]$Config, [object]$Plan, [object]$Slot)

    $files = Get-SlotFiles -Config $Config -Slot $Slot
    New-Item -ItemType Directory -Path $files.outputDir -Force | Out-Null
    $tags = @($Slot.categoryTags | ForEach-Object { [string]$_ } | Where-Object { $_ })
    if (-not $tags.Count) {
        for ($index = [int]$Slot.slot - 1; $index -lt $Plan.plan.Count; $index += $Config.bucketCount) {
            $tags += [string]$Plan.plan[$index].tag
        }
    }

    $settings = $Config.captureSettings
    $env:MT_CDP_ENDPOINT = "http://127.0.0.1:$($Slot.localPort)"
    $env:MT_CDP_PORT = [string]$Slot.remotePort
    $env:MT_TARGET_URL_PART = $Config.targetPart
    $env:MT_RUN_ID = $files.captureId
    $env:MT_CAPTURE_ID = $files.captureId
    $env:MT_TASK_ID = $files.captureId
    $env:MT_OUTPUT_DIR = $files.outputDir
    $env:MT_WORKER_ID = $Slot.worker
    $env:MT_STORE_ID = $Config.storeId
    $env:MT_STORE_NAME = $Config.storeName
    $env:MT_ACCOUNT_ID = $Slot.accountId
    $env:MT_ACCOUNT_LABEL = $Slot.label
    $env:MT_PROFILE_ID = $Slot.profile
    $env:MT_PROFILE_PATH = "remote-managed-profile"
    $env:MT_CATEGORY_TAGS = $tags -join ","
    $env:MT_CAPTURE_ALL_CATEGORIES = "false"
    $env:MT_DELAY_MIN_MS = [string]$settings.requestDelayMinMs
    $env:MT_DELAY_MAX_MS = [string]$settings.requestDelayMaxMs
    $env:MT_CATEGORY_REST_MIN_MS = [string]$settings.categoryRestMinMs
    $env:MT_CATEGORY_REST_MAX_MS = [string]$settings.categoryRestMaxMs
    $env:MT_RISK_SLEEP_MS = [string]$settings.riskSleepMs
    $env:MT_RISK_RETRIES = [string]$settings.riskRetries
    $env:MT_OBSERVED_SMOOTH_CHUNK_SIZE = [string]$settings.observedSmoothChunkSize
    $env:MT_MIN_SMOOTH_CHUNK_SIZE = [string]$settings.minSmoothChunkSize
    $env:MT_DYNAMIC_CHUNK_MODE = [string]$settings.dynamicChunkMode
    $env:MT_ALLOW_PAGE_FALLBACK = "false"

    $stdout = Join-Path $files.outputDir "$($files.captureId).console.log"
    $stderr = Join-Path $files.outputDir "$($files.captureId).error.log"
    $process = Start-Process `
        -FilePath $Config.nodePath `
        -ArgumentList $Config.captureScript `
        -WorkingDirectory $Config.projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    Set-Content -LiteralPath $files.pid -Value $process.Id -Encoding ascii

    Emit-Event -Event "CAPTURE_STARTED" -Data ([pscustomobject]@{
        slot = $Slot.slot
        device = $Slot.worker
        port = $Slot.remotePort
        account = $Slot.label
        pid = $process.Id
        categoryCount = $tags.Count
    })
}

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Watcher config is missing: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding utf8 | ConvertFrom-Json
$plan = Get-Content -LiteralPath $config.planPath -Raw -Encoding utf8 | ConvertFrom-Json
$activeSlots = @($config.slots | Where-Object {
    -not ($_.PSObject.Properties.Name -contains "enabled") -or [bool]$_.enabled
})
$heldSlots = @($config.slots | Where-Object {
    $_.PSObject.Properties.Name -contains "enabled" -and -not [bool]$_.enabled
})
New-Item -ItemType Directory -Path $config.runRoot -Force | Out-Null

$lastState = @{}
$lastSummary = [DateTime]::MinValue
Emit-Event -Event "WATCHER_STARTED" -Data ([pscustomobject]@{
    intervalSeconds = $config.pollSeconds
    slots = $config.slots.Count
    store = $config.storeName
})

while ($true) {
    $completed = 0
    $running = 0
    $waiting = 0
    $risk = 0
    $rows = @($heldSlots | ForEach-Object {
        [pscustomobject]@{
            slot = $_.slot
            port = $_.remotePort
            account = $_.label
            state = "manual_hold"
        }
    })

    foreach ($slot in $activeSlots) {
        $files = Get-SlotFiles -Config $config -Slot $slot
        if (Test-Path -LiteralPath $files.summary) {
            $summary = Get-Content -LiteralPath $files.summary -Raw -Encoding utf8 | ConvertFrom-Json
            if ($summary.status -eq "completed") {
                $state = "finished:completed"
                $completed += 1
            }
            else {
                try { $pages = Get-CdpPages -LocalPort $slot.localPort } catch { $pages = @() }
                $healthyStorePage = $pages |
                    Where-Object {
                        $_.url -like "*$($config.targetPart)*" -and
                        $_.title -eq $config.storeName
                    } |
                    Select-Object -First 1

                if ($healthyStorePage) {
                    $archive = "{0}.{1}.{2}.json" -f $files.summary.Substring(0, $files.summary.Length - 5), $summary.status, (Get-Date).ToString("yyyyMMddHHmmss")
                    Move-Item -LiteralPath $files.summary -Destination $archive -Force
                    Start-Capture -Config $config -Plan $plan -Slot $slot
                    $state = "running:restarted_after_$($summary.status)"
                    $running += 1
                    Emit-Event -Event "CAPTURE_RECOVERED" -Data ([pscustomobject]@{
                        slot = $slot.slot
                        device = $slot.worker
                        port = $slot.remotePort
                        account = $slot.label
                        previousStatus = $summary.status
                        archivedSummary = $archive
                    })
                }
                else {
                    $state = "blocked:$($summary.status)"
                    $risk += 1
                }
            }
        }
        elseif (Test-Path -LiteralPath $files.progress) {
            $last = Get-Content -LiteralPath $files.progress -Tail 1 -Encoding utf8 | ConvertFrom-Json
            $captureAlive = $false
            if (Test-Path -LiteralPath $files.pid) {
                $capturePid = Get-Content -LiteralPath $files.pid -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($capturePid) {
                    $captureAlive = [bool](Get-Process -Id ([int]$capturePid) -ErrorAction SilentlyContinue)
                }
            }

            if (-not $captureAlive) {
                try { $pages = Get-CdpPages -LocalPort $slot.localPort } catch { $pages = @() }
                $healthyStorePage = $pages |
                    Where-Object {
                        $_.url -like "*$($config.targetPart)*" -and
                        $_.title -eq $config.storeName
                    } |
                    Select-Object -First 1
                if ($healthyStorePage) {
                    Start-Capture -Config $config -Plan $plan -Slot $slot
                    $state = "running:restarted_after_exit"
                    $running += 1
                    Emit-Event -Event "CAPTURE_RESTARTED_AFTER_EXIT" -Data ([pscustomobject]@{
                        slot = $slot.slot
                        device = $slot.worker
                        port = $slot.remotePort
                        account = $slot.label
                        previousEvent = $last.event
                    })
                }
                else {
                    $state = "blocked:process_exited"
                    $risk += 1
                }
            }
            else {
                $state = "running:$($last.event)"
                $running += 1
                if ($last.event -eq "risk_pause") {
                    $risk += 1
                    $autoResumeRisk = $config.PSObject.Properties.Name -contains "autoResumeRisk" -and [bool]$config.autoResumeRisk
                    if ($autoResumeRisk) {
                        try {
                            $pages = Get-CdpPages -LocalPort $slot.localPort
                            $healthyStorePage = $pages |
                                Where-Object {
                                    $_.url -like "*$($config.targetPart)*" -and
                                    $_.title -eq $config.storeName
                                } |
                                Select-Object -First 1
                            if ($healthyStorePage) {
                                $resumeFile = Join-Path $files.outputDir "$($files.captureId).risk-resume.ok"
                                if (-not (Test-Path -LiteralPath $resumeFile)) {
                                    Set-Content -LiteralPath $resumeFile -Value "verified healthy by watcher" -Encoding ascii
                                    Emit-Event -Event "RISK_RESUME_SIGNALLED" -Data ([pscustomobject]@{
                                        slot = $slot.slot
                                        device = $slot.worker
                                        port = $slot.remotePort
                                        account = $slot.label
                                    })
                                }
                            }
                        }
                        catch {
                            Emit-Event -Event "RISK_RECHECK_FAILED" -Data ([pscustomobject]@{
                                slot = $slot.slot
                                port = $slot.remotePort
                                error = $_.Exception.Message
                            })
                        }
                    }
                }
            }
        }
        else {
            try { $pages = Get-CdpPages -LocalPort $slot.localPort } catch { $pages = @() }
            $storePage = $pages | Where-Object { $_.url -like "*$($config.targetPart)*" } | Select-Object -First 1
            $loggedPage = $pages |
                Where-Object {
                    $_.url -notlike "*h5.waimai.meituan.com/login*" -and
                    $_.title -notmatch "登录"
                } |
                Select-Object -First 1

            if (-not $storePage -and $loggedPage) {
                try {
                    $encodedTarget = [uri]::EscapeDataString($config.targetUrl)
                    Invoke-RestMethod `
                        -Method Put `
                        -Uri "http://127.0.0.1:$($slot.localPort)/json/new?$encodedTarget" `
                        -TimeoutSec 12 | Out-Null
                    Emit-Event -Event "STORE_OPENED" -Data ([pscustomobject]@{
                        slot = $slot.slot
                        device = $slot.worker
                        port = $slot.remotePort
                        account = $slot.label
                    })
                    Start-Sleep -Seconds $config.storeWarmupSeconds
                    $pages = Get-CdpPages -LocalPort $slot.localPort
                    $storePage = $pages |
                        Where-Object { $_.url -like "*$($config.targetPart)*" } |
                        Select-Object -First 1
                }
                catch {
                    Emit-Event -Event "STORE_OPEN_FAILED" -Data ([pscustomobject]@{
                        slot = $slot.slot
                        port = $slot.remotePort
                        error = $_.Exception.Message
                    })
                }
            }

            if ($storePage -and $storePage.title -notmatch "403|418|验证|核实|登录|异常") {
                Start-Capture -Config $config -Plan $plan -Slot $slot
                $state = "running:started"
                $running += 1
            }
            elseif ($storePage) {
                $state = "blocked:$($storePage.title)"
                $risk += 1
            }
            else {
                $state = "waiting_login"
                $waiting += 1
            }
        }

        $rows += [pscustomobject]@{
            slot = $slot.slot
            port = $slot.remotePort
            account = $slot.label
            state = $state
        }
        if ($lastState[$slot.slot] -ne $state) {
            Emit-Event -Event "STATE_CHANGED" -Data ([pscustomobject]@{
                slot = $slot.slot
                device = $slot.worker
                port = $slot.remotePort
                account = $slot.label
                state = $state
            })
            $lastState[$slot.slot] = $state
        }
    }

    if ((Get-Date) - $lastSummary -ge [TimeSpan]::FromMinutes($config.summaryMinutes)) {
        Emit-Event -Event "SUMMARY" -Data ([pscustomobject]@{
            completed = $completed
            running = $running
            waitingLogin = $waiting
            risk = $risk
            slots = $rows
        })
        $lastSummary = Get-Date
    }
    if ($completed -eq $activeSlots.Count) {
        Emit-Event -Event "WATCHER_COMPLETED" -Data ([pscustomobject]@{ completed = $completed })
        break
    }
    Start-Sleep -Seconds $config.pollSeconds
}
