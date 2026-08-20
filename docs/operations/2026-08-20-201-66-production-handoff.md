# 2026-08-20 201/66 生产部署交接

## 1. 结论

66 的开发部署已完成，可交给业务人员登录账号并执行门店任务。201 的 Master 控制面、监控、正式钉钉通知、本地备份和隔离恢复均已部署，技术迁移已经完成。当前尚未在新体系中完成真实门店的 `run -> 原始产物 -> 质量门禁 -> Excel` 现场验收，因此整个业务项目暂不能标记为完整闭环。

账号人工状态、验证码和 CDP 未启动属于业务开跑前状态，不等同于系统部署失败。系统当前正确显示阻断，不得改成假 100%。

## 2. 版本

| 节点 | 运行版本 | 运行 commit | 固定 Codex 工程 commit |
|---|---|---|---|
| 201 Master | `0.2.18` | `746b67246adb8d60c1bfe8f4fe523dc5bd4be372` | `dc5f78ab0cef1e34435a46201528c5bf0bcd04c5` |
| 66 独立节点 Master | `0.2.18` | `746b67246adb8d60c1bfe8f4fe523dc5bd4be372` | `dc5f78ab0cef1e34435a46201528c5bf0bcd04c5` |
| 66 Worker | `0.2.18` | Worker 签名制品 `0.2.18` | 同上 |

## 3. 201 已验证

- 固定工程：`D:\SpanAI\retail-price-orchestrator`，工作树干净。
- 运行根目录：`D:\SpanAI\retail-radar-master`。
- 当前源码：`sources\v0.2.18`；`app` 已原子切换到当前版本，旧 app 完整保留。
- 8 个容器：Caddy、Dashboard、Master、PostgreSQL、Redis、MinIO、Prometheus、Alertmanager。
- `/ready`：PostgreSQL、Redis、object storage 全部通过。
- 4 个 Worker 在线；账号和 CDP 状态按实时心跳显示。
- 2026-08-20 实时 API：4 个 Worker 在线、10 个账号、10 个 CDP 席位；账号和 CDP 未人工确认时保持阻断，不伪造就绪。
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

201 已通过受限凭据文件配置正式 `DINGTALK_WEBHOOK_URL`，主配置和镜像配置均已更新，脚本返回 `success=true`。2026-08-20 完成受控 firing/resolved 演练：2 条通知均进入 `sent`，人工复核队列为 0；文档和日志不记录 Webhook 原文。

### 业务开跑门禁

- 业务人员启动目标 Worker 的 CDP 并登录账号。
- 在标识页确认账号、归属人和目标门店。
- 处理验证码或风险账号。
- 先做小类目 Canary，再扩大到全门店。

上述业务项不影响“66 已部署完成”和“201 总控已运行”的技术结论，但未完成前不得把门店采集标为完成。

## 8. 最终闭环状态

### 已完成

- 201 Master 与 66 独立节点部署、固定工程、启动交接、监控、备份和隔离恢复均已验证。
- 正式钉钉 Webhook 已加载，firing/resolved 演练 `sent=2`、人工复核为 0。
- GitHub、201、66 固定工程一致；历史 JSONL、登录态和 Profile 未被错误迁移。

### 尚未完成

- 201 当前真实业务运行数和交付数均为 0；8 个账号仍需人工确认，10 个 CDP 席位尚未形成可采集状态。
- 66 当前账号数、真实业务运行数和交付数均为 0；5 个 CDP 席位需要业务人员登录后验收。
- 尚无新体系产生的真实原始 artifact、质量结论和 Excel 交付证据。

### 唯一剩余闭环路径

1. 业务人员在目标节点登录账号，并核对账号、Profile、CDP、门店标识。
2. 201 和 66 各执行一个健康账号、一个正确门店、一个小类目的现场 Canary。
3. 验证 checkpoint、原始 JSONL、artifact 上传、质量门禁和 Excel 下载后，由业务人员确认可独立操作。

完成以上三步后，才可把状态从“技术迁移完成”更新为“业务正式闭环”。不需要继续扩展功能，也不需要迁移旧 JSONL。
