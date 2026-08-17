# Worker 接入手册

每台设备只安装一个 Worker。一个 Worker 可以登记多个稳定 Browser Slot，但账号、Profile、CDP 和目标门店的绑定由 Master 管理，不能靠端口号或人工记忆推断。

## 1. 接入前检查

- Worker 与 Master 位于同一受控局域网，能够解析 `retail-master.local`。
- Node.js 22+、Google Chrome 已安装。
- 已从 Master 导出 `master-root.crt`。
- 已在操作台生成一次性接入码；接入码只用于首次换取独立 Worker 凭据。
- 已确定业务机器名和远程桌面定位信息；无需也不得人工指定 Worker ID。
- SSH 只用于安装、升级和故障维护，不承载调度、心跳或采集控制。

### 1.1 设备身份与固定 IP

每台 Worker 在接入前先登记到钉钉“商圈比价 Worker 设备与网络台账”。一台物理设备只保留一条记录，至少填写 Worker 编号、设备名称、设备归属人、主机名、操作系统、设备角色、固定 IP、MAC 地址、IP 固定方式、SSH 用户名、SSH 别名和设备状态。

固定 IP 首选在网关或路由器按 MAC 地址配置 DHCP 地址保留。只有无法管理 DHCP 时才在 Worker 手工配置静态地址，并同时核对地址池、网关和 DNS，避免地址冲突。SSH 密码、远程协助密码、私钥、验证码不得写入钉钉、源码或日志。

Windows Worker 本机身份核对：

```powershell
[pscustomobject]@{
  UserName = (whoami)
  HostName = hostname
  IPv4 = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -eq '<待固定IP>'}).IPAddress
  MacAddress = (Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Select-Object -First 1 -ExpandProperty MacAddress)
  SshServer = (Get-WindowsCapability -Online | Where-Object {$_.Name -like 'OpenSSH.Server*'}).State
}
```

`whoami` 返回 `主机名\用户名` 时，SSH 配置使用反斜杠后的本地用户名。Master 使用独立 Ed25519 密钥登录 Worker；首次密码只用于安装公钥，验证成功后不在系统内留存。

## 2. Windows 安装

使用管理员 PowerShell 执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\deploy\windows\install-worker.ps1 `
  -MasterUrl "https://retail-master.local:2808" `
  -MasterVersion "0.1.5" `
  -EnrollmentToken "<一次性接入码>" `
  -MachineLabel "mm Windows" `
  -ManifestUrl "<release-manifest.json URL>" `
  -WinSWUrl "<固定版本 WinSW.exe URL>" `
  -WinSWSha256 "<WinSW 官方发布文件 SHA256>" `
  -MasterCaCertificatePath ".\master-root.crt" `
  -RemoteDesktopProvider "rdp" `
  -RemoteDesktopTarget "192.0.2.10"
```

安装器会检查 Node、Chrome、安装目录写权限和 Master HTTPS，校验 Worker 包与 WinSW 的 SHA256，创建不可变版本目录并注册 `RetailRadarWorker`。WinSW 配置了自动启动、延迟启动、15/30/120 秒失败恢复和滚动日志。Master 生成并下发的 `worker_id` 是安装健康检查、服务心跳和后续升级的唯一 Worker ID；`MachineLabel` 仅供人员识别，不能用于实体查询。

Windows 服务位于 Session 0，现代 Windows 不保证服务启动的 Chrome 在运营人员桌面可见。因此安装器将职责拆成两部分：WinSW 核心服务负责心跳、任务和产物，登录用户会话中的 `RetailRadarCdpHelper` 计划任务只负责领取 CDP 启停命令。助手以隐藏 PowerShell 启动，但 Chrome 位于当前用户桌面，验证码和登录异常可由同事直接处理。不要启用 WinSW 的 `interactive` 选项，也不要在核心服务中打开 `WORKER_ENABLE_CDP_COMMANDS`。

验证：

```powershell
Get-Service RetailRadarWorker
Get-Content "$env:ProgramData\RetailRadar\Worker\service\RetailRadarWorker.out.log" -Tail 50
```

首次接入成功后，安装器会从受 ACL 保护的环境文件中删除一次性接入码，只保留 Master 下发并原子写入 `state/worker-identity.json` 的 Worker 独立凭据。

如果注册成功后因版本健康、服务状态或网络检查失败，安装器只回滚服务、活动链接和本次候选版本，保留有效的独立凭据。修复外部原因后可直接重跑安装命令；即使原接入码已消费，安装器也会从 identity 文件恢复 Master 下发的 Worker ID 和凭据，不会再次注册新实体。不要删除或复制 `worker-identity.json`。

## 3. macOS 安装

在登录的运营用户终端执行：

```bash
chmod 700 deploy/macos/*.sh
deploy/macos/install-worker.sh \
  --master-url "https://retail-master.local:2808" \
  --master-version "0.1.0" \
  --enrollment-token "<一次性接入码>" \
  --machine-label "jl Mac" \
  --manifest-url "<release-manifest.json URL>" \
  --master-ca ./master-root.crt \
  --remote-provider screen_sharing \
  --remote-target 192.0.2.24
```

安装器使用 `~/Library/Application Support/RetailRadar/Worker` 专用目录和用户级 `launchd` LaunchAgent。用户级会话允许 Chrome 与人工验证码处理保持可见；`KeepAlive`、`RunAtLoad` 和 `caffeinate` 防止长任务因应用休眠中断。失败重试与 Windows 使用同一身份规则：保留 identity，仅清理部分加载的 LaunchAgent、链接和候选版本。

验证：

```bash
launchctl print "gui/$(id -u)/com.retailradar.worker"
tail -n 50 "$HOME/Library/Application Support/RetailRadar/Worker/logs/worker.stdout.log"
```

## 4. 接入后的业务核对

1. 操作台只出现一个物理 Worker，IP、主机名和最后心跳与真实设备一致。
2. 为每个账号创建稳定 Browser Slot，并绑定唯一 Profile、账号归属人和固定目标门店。
3. 检查 CDP 标识页的账号和门店与操作台一致；错误门店必须阻断领取。
4. 打开远程桌面入口，确认能定位到正确设备和账号。
5. 只创建一个小类目做 canary，确认 checkpoint、原始 JSONL、商品结构化入库和到手价质量门均有记录。
6. canary 完成后再扩大类目，不用 SSH 发采集命令。

## 5. 常见失败

- HTTPS 失败：重新分发 Caddy 根证书，禁止使用跳过证书校验参数。
- 接入码失败且本机没有 identity：接入码可能已使用或过期，重新签发；如果 identity 已存在，先按原安装命令重试，禁止为同一设备重新注册实体。
- Worker 重复：不要复制 `state/worker-identity.json` 到另一台机器。
- Chrome 不可见：确认进程属于当前登录用户会话；Windows 不应由 Session 0 服务直接弹出交互窗口。
- Master 显示离线：检查服务、系统时间、局域网 DNS、证书和 `lastSeenAt`，再查日志。
