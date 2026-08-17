[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AccountMapPath,
    [string]$LoginUrl = "https://h5.waimai.meituan.com/login",
    [string]$ProfileRoot = "C:\ProgramData\RetailRadar\Bootstrap\profiles",
    [switch]$PreserveLoginPages
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AccountMapPath -PathType Leaf)) {
    throw "Account map is missing: $AccountMapPath"
}

$config = Get-Content -LiteralPath $AccountMapPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Open-CdpPage {
    param(
        [string]$Endpoint,
        [string]$TargetUrl
    )

    $encoded = [uri]::EscapeDataString($TargetUrl)
    return Invoke-RestMethod -Method Put -Uri "$Endpoint/json/new?$encoded" -TimeoutSec 10
}

function Get-CdpPages {
    param([string]$Endpoint)

    $response = Invoke-WebRequest -UseBasicParsing -Proxy $null -Uri "$Endpoint/json/list" -TimeoutSec 5
    return @($response.Content | ConvertFrom-Json)
}

function Close-CdpPage {
    param(
        [string]$Endpoint,
        [string]$PageId
    )

    try {
        Invoke-WebRequest -UseBasicParsing -Proxy $null -Method Get -Uri "$Endpoint/json/close/$PageId" -TimeoutSec 5 | Out-Null
    }
    catch {
        # Chrome may close a blank page before the close response is read.
    }
}

function New-IdentityHtml {
    param(
        [object]$Config,
        [object]$Slot,
        [string]$Browser
    )

    $status = if ($Slot.status -eq "pending_login_verification") { "待登录核验" } else { [string]$Slot.status }
    $port = ConvertTo-HtmlText $Slot.cdpPort
    $owner = ConvertTo-HtmlText $Slot.owner
    $phone = ConvertTo-HtmlText $Slot.phone
    $profile = ConvertTo-HtmlText $Slot.profile
    $slotName = ConvertTo-HtmlText $Slot.slot
    $device = ConvertTo-HtmlText "$($Config.deviceLabel) / $($Config.worker)"
    $store = ConvertTo-HtmlText $Config.targetStoreName
    $safeStatus = ConvertTo-HtmlText $status
    $endpoint = ConvertTo-HtmlText "http://127.0.0.1:$($Slot.cdpPort)"
    $storageKey = ConvertTo-Json -Compress "retail-radar-identity:$($Slot.profile)"

    return @"
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Retail-Radar CDP Identity / $port / $owner</title>
  <style>
    :root{font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;color:#172033;background:#eef3fa}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef3fa}
    main{width:min(760px,calc(100vw - 40px));background:#fff;border:1px solid #d5dfef;border-radius:12px;box-shadow:0 18px 55px rgba(23,32,51,.14);overflow:hidden}
    header{padding:24px 30px;background:#174ea6;color:#fff}h1{margin:0;font-size:34px;letter-spacing:0}.sub{margin:9px 0 0;font-size:16px;opacity:.9}
    section{padding:24px 30px 28px}.grid{display:grid;grid-template-columns:155px 1fr;gap:12px 18px;align-items:center}
    label{font-size:15px;color:#526079}input{width:100%;padding:10px 12px;border:1px solid #c8d2e1;border-radius:7px;background:#fff;color:#172033;font-size:17px;font-weight:650;outline:none}
    input:focus{border-color:#174ea6;box-shadow:0 0 0 3px rgba(23,78,166,.13)}input[readonly]{background:#f5f7fa;color:#667085}
    .strong{font-size:20px;font-weight:850}.phone{color:#b42318}.endpoint{color:#174ea6;font-family:Consolas,monospace}
    .actions{display:flex;align-items:center;gap:14px;margin-top:22px}button{border:0;border-radius:7px;padding:11px 20px;background:#174ea6;color:#fff;font-size:16px;font-weight:750;cursor:pointer}
    #save-status{color:#027a48;font-weight:700}.note{margin-top:18px;padding:13px 15px;background:#eef3fa;border-radius:7px;color:#344054;line-height:1.6}
  </style>
</head>
<body>
<main>
  <header><h1>$slotName · CDP $port</h1><p class="sub">账号、归属人与目标门店标识</p></header>
  <section>
    <div class="grid">
      <label for="device">设备 / Worker</label><input id="device" value="$device" readonly>
      <label for="endpoint">CDP Endpoint</label><input id="endpoint" class="endpoint strong" value="$endpoint" readonly>
      <label for="port">CDP 端口</label><input id="port" class="endpoint strong" value="$port" readonly>
      <label for="account">账号槽位</label><input id="account" class="strong" value="$slotName">
      <label for="phone">登录手机号</label><input id="phone" class="strong phone" value="$phone">
      <label for="owner">账号所属人</label><input id="owner" class="strong" value="$owner">
      <label for="store">目标门店</label><input id="store" class="strong" value="$store">
      <label for="profile">Profile</label><input id="profile" value="$profile" readonly>
      <label for="status">初始状态</label><input id="status" value="$safeStatus" readonly>
      <label for="browser">Browser</label><input id="browser" value="$(ConvertTo-HtmlText $Browser)" readonly>
    </div>
    <div class="actions"><button id="save" type="button">保存标识</button><span id="save-status">尚未人工确认</span></div>
    <div class="note">手机号、所属人、账号槽位或目标门店发生变化时，请修改后点击“保存标识”。实际登录和门店页面请保留在其他标签页。</div>
  </section>
</main>
<script>
(() => {
  const storageKey = $storageKey;
  const editable = ["account","phone","owner","store"];
  const status = document.getElementById("save-status");
  const values = () => Object.fromEntries(editable.map(id => [id, document.getElementById(id).value.trim()]));
  const render = savedAt => status.textContent = savedAt ? "已本地保存：" + new Date(savedAt).toLocaleString() : "尚未人工确认";
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (stored && stored.values) {
      for (const id of editable) if (stored.values[id]) document.getElementById(id).value = stored.values[id];
      render(stored.savedAt);
    }
  } catch { status.textContent = "本地记录读取失败，请重新填写"; }
  document.getElementById("save").addEventListener("click", () => {
    const payload = { values: values(), savedAt: new Date().toISOString() };
    try { localStorage.setItem(storageKey, JSON.stringify(payload)); render(payload.savedAt); }
    catch { status.textContent = "本地保存失败，请保留本页并通知维护人员"; }
  });
})();
</script>
</body>
</html>
"@
}

function ConvertTo-HtmlText {
    param([object]$Value)

    return [System.Net.WebUtility]::HtmlEncode([string]$Value)
}

$results = @()

foreach ($slot in $config.slots) {
    $port = [int]$slot.cdpPort
    $endpoint = "http://127.0.0.1:$port"
    try {
        $version = Invoke-RestMethod -Uri "$endpoint/json/version" -TimeoutSec 5
        $pages = Get-CdpPages -Endpoint $endpoint
        $existingLoginPage = @($pages | Where-Object { $_.url -eq $LoginUrl }) | Select-Object -First 1
        $existingBusinessPage = @(
            $pages | Where-Object {
                $_.type -eq "page" -and
                $_.url -ne "about:blank" -and
                $_.url -notlike "data:text/html*"
            }
        ) | Select-Object -First 1

        foreach ($page in $pages) {
            if (
                $page.id -and (
                    $page.title -like "Retail-Radar CDP Identity*" -or
                    (-not $PreserveLoginPages -and $page.url -eq $LoginUrl)
                )
            ) {
                Close-CdpPage -Endpoint $endpoint -PageId $page.id
            }
        }

        $preservedPage = if ($existingLoginPage) { $existingLoginPage } else { $existingBusinessPage }
        $loginPage = if ($PreserveLoginPages -and $preservedPage) {
            $preservedPage
        }
        else {
            Open-CdpPage -Endpoint $endpoint -TargetUrl $LoginUrl
        }
        $identityHtml = New-IdentityHtml -Config $config -Slot $slot -Browser $version.Browser
        $identityDirectory = Join-Path $ProfileRoot ([string]$slot.profile)
        New-Item -ItemType Directory -Path $identityDirectory -Force | Out-Null
        $identityFile = Join-Path $identityDirectory "retail-radar-identity.html"
        [System.IO.File]::WriteAllText($identityFile, $identityHtml, [System.Text.UTF8Encoding]::new($false))
        $identityUrl = ([uri]$identityFile).AbsoluteUri
        $identityPage = Open-CdpPage -Endpoint $endpoint -TargetUrl $identityUrl

        $currentPages = Get-CdpPages -Endpoint $endpoint
        foreach ($page in $currentPages) {
            if ($page.id -and $page.url -eq "about:blank") {
                Close-CdpPage -Endpoint $endpoint -PageId $page.id
            }
        }

        $results += [pscustomobject]@{
            slot = $slot.slot
            port = $port
            owner = $slot.owner
            identity_page = [bool]$identityPage.id
            login_page = [bool]$loginPage.id
            target_store_opened = $false
        }
    }
    catch {
        $results += [pscustomobject]@{
            slot = $slot.slot
            port = $port
            owner = $slot.owner
            identity_page = $false
            login_page = $false
            target_store_opened = $false
            error = $_.Exception.Message
        }
    }
}

$results | ConvertTo-Json -Depth 4
