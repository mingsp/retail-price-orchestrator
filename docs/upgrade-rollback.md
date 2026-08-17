# Worker 升级与回滚手册

Worker 发布物是不可变版本目录。`current` 只是指向当前版本的链接；升级绝不覆盖已存在版本。发布清单必须包含版本、平台、下载 URL、SHA256、文件大小和最低 Master 版本。

## 1. 构建发布物

```powershell
pnpm build:production
pnpm release:worker -- --version 1.1.0 --output deploy/release/out
pnpm release:manifest -- `
  --version 1.1.0 `
  --minimum-master-version 0.1.0 `
  --base-url https://<受控发布地址>/worker/1.1.0 `
  --artifact windows-x64=deploy/release/out/retail-radar-worker-1.1.0-windows-x64.zip `
  --artifact macos-arm64=deploy/release/out/retail-radar-worker-1.1.0-macos-arm64.tar.gz `
  --artifact macos-x64=deploy/release/out/retail-radar-worker-1.1.0-macos-x64.tar.gz `
  --output deploy/release/out/release-manifest-1.1.0.json
```

清单生成使用 `flag=wx`，如果目标清单已存在会失败。发布地址应是只读 GitHub Release、受控对象存储或内部制品库，不能指向可被原地替换的同名文件。

## 2. 事务化升级顺序

升级脚本先从受保护的 `state/worker-identity.json` 读取 Master 下发的 `worker_id`，再用该 ID 执行 drain、健康检查和恢复；命令行不接受人工 Worker ID。

升级脚本固定执行：

1. **drain**：按 identity 中的 Worker ID 查询活动任务，通过 Master 自动化 API 置为可恢复暂停，直到活动任务为零。
2. **下载**：下载到 `work` 临时目录，不写入 `current`。
3. **校验**：核对最低 Master 版本、平台、SHA256 和 `dist/index.js`。
4. **切换**：把包移动到新的 `releases/<version>`，创建 `current.next`，保留 `current.previous` 后再切换。
5. **重启**：重启 WinSW 或 launchd。
6. **健康确认**：Master 必须看到该 Worker `online` 且 `bootId` 与升级前不同。
7. **失败回滚**：健康超时后停止新版本，恢复 `current.previous`，重启旧版本并再次确认在线。

任何版本目录、`current.next` 或 `current.previous` 异常残留都会阻断升级，不会静默删除或覆盖。失败的新版本目录保留供排查，确认后由维护人员显式归档。升级、回滚和首次安装恢复都不得删除 `worker-identity.json` 或轮换其独立凭据。

## 3. Windows 升级

```powershell
& "$env:ProgramData\RetailRadar\Worker\service\upgrade-worker.ps1" `
  -ManifestUrl "<release-manifest.json URL>" `
  -MasterUrl "https://retail-master.local:2808" `
  -CurrentMasterVersion "0.1.0" `
  -AutomationToken "<Codex自动化令牌>"
```

不要用 `Copy-Item -Force` 替换 `current` 内容。升级完成后检查 Windows 服务状态、Master 的新 `bootId`、原任务 checkpoint 和风险事件。

## 4. macOS 升级

```bash
"$HOME/Library/Application Support/RetailRadar/Worker/service/upgrade-worker.sh" \
  --manifest-url "<release-manifest.json URL>" \
  --master-url "https://retail-master.local:2808" \
  --master-version "0.1.0" \
  --automation-token "<Codex自动化令牌>"
```

脚本使用当前用户的 `gui/<uid>/com.retailradar.worker` LaunchAgent，不要改成 root LaunchDaemon，否则 Chrome 和人工验证会离开当前图形会话。

## 5. 回滚验收

- `current` 指向升级前版本，服务状态为 Running/launchd active。
- Master 显示 Worker 在线并产生新 `bootId`。
- drain 前暂停的任务仍保留 checkpoint、固定账号/Profile/CDP/门店绑定。
- 没有任务被重复标记完成，没有新旧进程同时上传 artifact。
- SHA256 失败、Master 版本过低、健康检查失败均能在日志中看到明确原因。

自动回滚失败时停止继续操作，保留 `releases`、`work` 和服务日志，按故障升级处理；不要手工复制文件到 `current`。
