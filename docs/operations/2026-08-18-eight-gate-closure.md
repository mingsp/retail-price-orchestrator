# 2026-08-18 八项生产闭环现场台账

## 1. 结论

截至 2026-08-18 12:11（Asia/Shanghai），66 单店节点的基础设施、控制面、Browser Slot、CDP、人工介入入口、监控告警、备份恢复和可回滚发布已经通过现场验证。Master 与 Worker 均运行 `0.2.18`，Git commit 为 `746b67246adb8d60c1bfe8f4fe523dc5bd4be372`。

66 的开发与部署职责已经完成。真实账号登录、门店任务执行、验证码处理和业务数据验收由业务人员负责，不作为 66 部署交付的阻断项。201 是长期总控；当前登记的 `192.168.100.201` 在 WLAN 上无 ARP，需先核对实际 IP 后继续总控部署。

## 2. 八项门禁状态

| 门禁 | 当前状态 | 已验证证据 | 剩余动作 |
|---|---|---|---|
| 1. 固定版本与工程基线 | 通过 | GitHub `main` 与 `v0.2.18` 指向固定提交；Node 22.14.0 下测试、类型检查、生产构建和公开脱敏验证通过 | 无 |
| 2. 201 Master 运行治理 | 阻断 | 201 本机 `sshd` 已运行并监听；从 34 强制 WLAN 访问旧 IP 超时且无 ARP | 核对 201 当前 IPv4/MAC，修正 SSH 固定配置后执行版本和计划任务复核 |
| 3. 监控与钉钉告警 | 66 通过，201 待复核 | Prometheus、Alertmanager 健康；通知 `sent=2`、attention=0；Webhook 配置在受保护文件中 | 201 恢复后复核同一链路 |
| 4. 备份、异机副本与恢复 | 66 现场通过，长期目的地待切换 | PostgreSQL 与 MinIO 一致性备份；隔离恢复通过；临时异机副本两份 SHA256 一致 | 将异机目标从临时 34 主机切换到 201 或正式备份机并安装每日/每周任务 |
| 5. Browser Slot/Profile/CDP | 66 通过 | 5 个稳定席位，端口 19661-19665；5 条 `open_identity_page` 命令全部完成；纯采集 Profile 与连接 ID 分离 | 无开发侧剩余动作；业务登录时填写真实绑定 |
| 6. 业务使用准备 | 66 通过 | 登录页、标识页、RDP 和 5 个独立 Profile 已准备；平台不会伪造账号或门店 | 业务人员自行登录并执行门店任务 |
| 7. 技术故障恢复 | 开发验证通过 | 租约丢失可在 0.5 秒内终止 Windows 采集进程树；暂停、迁移、旧 generation 409、告警恢复均有自动测试 | 业务运行遇到真实验证码或 403/418 时按操作手册处理，问题反馈给开发 |
| 8. 开发部署交接 | 66 完成，201 待完成 | 66 版本、服务、CDP、RDP、告警、备份恢复和回滚证据齐全 | 完成 201 总控部署、长期备份目标和最终总控交接 |

## 3. 66 当前事实

- Master：`0.2.18` / `746b67246adb8d60c1bfe8f4fe523dc5bd4be372`。
- Worker：`0.2.18`，状态 online，升级后 bootId 已变化并稳定超过 30 秒。
- Browser Slot：5 个，端口 `19661` 至 `19665`，Profile 为 `rr66-xcgjz-01` 至 `rr66-xcgjz-05`。
- 页面：每个 Profile 都有可编辑标识页和美团 H5 登录页，状态均为 `login_required`。
- 远程处理：RDP `192.168.100.66:3389` 可达，防火墙 RemoteAddress 为 `LocalSubnet`。
- 执行池：采集并发 5、队列 5；内存 96% 前不降并发，99% 保护停止。
- 数据任务：活动任务 0；账号 0；未开始采集。

## 4. 职责边界

### 开发负责

1. 开发、测试、发布、部署和升级 Master/Worker。
2. 提供 Browser Slot、独立 Profile、CDP、标识页、RDP、监控、告警、备份和回滚能力。
3. 修复平台、采集器、调度、数据链路与可靠性问题。
4. 维护 GitHub 版本、交接文档和生产就绪证据。

### 业务负责

1. 登录真实账号并在标识页填写账号、归属人和目标门店。
2. 在 201 总控下创建并执行门店采集任务。
3. 处理验证码、账号状态和业务范围确认。
4. 验收门店数据与 Excel/数据库业务结果，并向开发反馈平台问题。

## 5. 201 接入核对

201 的 `sshd` 已确认运行。继续接入前核对真实网卡信息：

```powershell
hostname
Get-NetIPConfiguration |
  Where-Object IPv4Address |
  Select-Object InterfaceAlias,
    @{N='IPv4';E={$_.IPv4Address.IPAddress}},
    @{N='Gateway';E={$_.IPv4DefaultGateway.NextHop}}

Get-NetAdapter |
  Where-Object Status -eq 'Up' |
  Select-Object Name,MacAddress,Status
```

恢复 SSH 后，Codex 先只读核对 201 的版本、容器、计划任务、备份策略和 Worker 清单，再准备候选，不覆盖现有运行目录。

## 6. 禁止误报

- 端口监听不等于服务可用。
- Worker 在线不等于账号已登录。
- CDP 页面存在不等于门店预检通过。
- Worker 自报完成不等于类目 `completed_valid`。
- 有 Excel 不等于全店完整。
- 开发部署完成不等于业务已经登录账号或执行门店采集，两类完成状态必须分开记录。
