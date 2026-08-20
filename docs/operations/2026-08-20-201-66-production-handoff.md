# 2026-08-20 201/66 生产部署交接

## 1. 结论

66 的开发部署已完成，可交给业务人员登录账号并执行门店任务。201 的 Master 控制面、监控、钉钉台账 dry-run、本地备份和隔离恢复均已部署；正式创建采集任务前还需要管理员在 201 隐藏输入正式钉钉机器人 Webhook。

账号人工状态、验证码和 CDP 未启动属于业务开跑前状态，不等同于系统部署失败。系统当前正确显示阻断，不得改成假 100%。

## 2. 版本

| 节点 | 运行版本 | 运行 commit | 固定 Codex 工程 commit |
|---|---|---|---|
| 201 Master | `0.2.18` | `746b67246adb8d60c1bfe8f4fe523dc5bd4be372` | `ce58dab4bd43848c5f3c5cb3e755e6af5c77aa09` |
| 66 独立节点 Master | `0.2.18` | `746b67246adb8d60c1bfe8f4fe523dc5bd4be372` | `ce58dab4bd43848c5f3c5cb3e755e6af5c77aa09` |
| 66 Worker | `0.2.18` | Worker 签名制品 `0.2.18` | 同上 |

## 3. 201 已验证

- 固定工程：`D:\SpanAI\retail-price-orchestrator`，工作树干净。
- 运行根目录：`D:\SpanAI\retail-radar-master`。
- 当前源码：`sources\v0.2.18`；`app` 已原子切换到当前版本，旧 app 完整保留。
- 8 个容器：Caddy、Dashboard、Master、PostgreSQL、Redis、MinIO、Prometheus、Alertmanager。
- `/ready`：PostgreSQL、Redis、object storage 全部通过。
- 4 个 Worker 在线；账号和 CDP 状态按实时心跳显示。
- 钉钉生产台账 dry-run：6 个门店、11 个账号、3 个业务 Worker 记录可读，最近执行结果 0。
- 每日 03:00 本地备份；每周日 04:00 隔离恢复。SYSTEM 身份实跑通过。
- 升级前 PostgreSQL/MinIO 备份与隔离恢复通过；旧 `0.2.5` 镜像、源码和 app 目录保留为回滚证据。
- 私有启动文件：`D:\SpanAI\retail-radar-master\handoff\START-CODEX.md`。

## 4. 66 已验证

- 固定工程：`D:\SpanAI\retail-price-orchestrator`，工作树干净。
- 独立节点：`C:\ProgramData\RetailRadar\Standalone`。
- Worker：`C:\ProgramData\RetailRadar\Worker`。
- 8 个容器健康；Master 与 Worker 均为 `0.2.18`。
- 5 个 CDP 端口 `19661` 至 `19665` 正在监听，Browser Slot 和 Profile 一一对应。
- RDP 为局域网 ready；业务人员可自行登录和处理验证码。
- 每日备份和每周隔离恢复已安装，SYSTEM 身份实跑通过。
- 私有启动文件：`C:\ProgramData\RetailRadar\Standalone\handoff\START-CODEX.md`。

## 5. 本次明确未迁移的数据

本次没有从 66、34 或旧采集目录向 201 复制任何历史 JSONL、Excel、截图、checkpoint、Chrome Profile、Cookie 或登录态。

传输到 201 的只有：

- 固定 Git Bundle 和交接文档。
- 固定 Node/pnpm 离线依赖缓存。
- 无密钥 PowerShell 运维脚本。
- Node、Nginx、Prometheus、Alertmanager Docker 镜像；镜像包不包含 volume。

## 6. 数据归档和 Excel

- Worker 本地：`storeId/runId/taskId/captureId.*`。
- Master 原始对象：`storeId/runId/taskId/...`，含 SHA-256 和 versionId。
- 同一商品跨类目出现时保留各自类目事实，不跨类目去重。
- 所有冻结类目 `completed_valid`、原始 artifact 和质量门禁通过后，才生成 `business-exports/runId/vN/store-price-data.xlsx`。
- Excel 包含商品清单、SKU规格明细、类目汇总和说明，不包含账号/Profile/CDP/本机路径。

## 7. 剩余人工门禁

### 开发部署门禁

201 的 `DINGTALK_WEBHOOK_URL` 仍是占位符。管理员必须运行固定工程中的 `configure-dingtalk-webhook.ps1`，在隐藏输入中录入正式 Webhook，并确认脚本输出 `success=true`。

### 业务开跑门禁

- 业务人员启动目标 Worker 的 CDP 并登录账号。
- 在标识页确认账号、归属人和目标门店。
- 处理验证码或风险账号。
- 先做小类目 Canary，再扩大到全门店。

上述业务项不影响“66 已部署完成”和“201 总控已运行”的技术结论，但未完成前不得把门店采集标为完成。
