# GitHub、66 与 201 v0.2.5 生产交接记录

## 1. 当前结论

`v0.2.5` 已按“固定版本、无覆盖目录、联合备份、单节点 Canary、第二节点切换”的顺序部署到 66 和 201。两端当前 Master/Dashboard 均运行正式版本，旧源码目录、旧镜像、Profile、账号登录态、checkpoint、spool、原始产物和数据库未删除。

本记录是 `v0.2.5` 在 66/201 的唯一发布事实源。账号、Profile、CDP、门店和在线状态仍属于现场易变事实，每次操作前必须重新读取 Master、Worker 和页面。

## 2. 发布身份

| 项目 | 值 |
|---|---|
| Tag | `v0.2.5` |
| 运行 commit | `bc61bacf316ca6139973984fd6ed803537f3bb09` |
| schemaVersion | `2026-08-17-p0.1` |
| GitHub `main` 证据提交 | `caca1e39357c3dd9513b0affb4c53d521d708ad8` |
| 固定 Codex 项目入口 | 201：`D:\SpanAI\retail-price-orchestrator` |
| 版本化运行源码 | 201：`D:\SpanAI\retail-radar-master\sources\v0.2.5`；66：`C:\ProgramData\RetailRadar\Standalone\sources\v0.2.5` |

201 的 Codex、人工维护和日常开发始终从固定项目入口进入；版本化运行源码只供部署、Canary、回滚和取证使用，不作为人员每次切换的工作目录。生产运行固定在 Tag/commit，不直接运行随后变化的 `main`。`main` 可以包含发布后的证据文档，但不能据此认定生产代码已经再次升级。

## 3. 节点职责

| 节点 | 当前职责 | 本次切换前镜像 | 当前镜像 |
|---|---|---|---|
| 201 | 长期 Master；负责呱呱超市（昆明路店）与犀牛百货（科技路店） | Master/Dashboard `0.1.6-blockerfix-20260811-784444c1` | Master/Dashboard `0.2.5` |
| 66 | 小柴购（甘家寨店）独立单店节点 | Master/Dashboard `0.1.0` | Master/Dashboard `0.2.5` |

门店职责变化必须先更新生产台账和 Master，再更新本记录。不得仅凭历史会话把任务跨节点迁移。

## 4. 切换前门禁与备份

两端切换前活动任务均为 0。PostgreSQL 使用自包含 dump，MinIO 使用暂停后的版本卷归档；备份文件均计算 SHA-256。

| 节点 | 备份目录 | PostgreSQL | MinIO |
|---|---|---|---|
| 66 | `C:\ProgramData\RetailRadar\Standalone\backups\predeploy-20260817-172310` | 353,069 字节；`afba48c25b68d41bcda2f02e000f195eea6a751894384e7658d288108ad42c8c` | 65,536 字节；`bdaae2b1f75a6fbf2672fac34b87261fe02a77d73260bf14d5c7550acd018d42` |
| 201 | `D:\SpanAI\retail-radar-master\backups\predeploy-20260817-172342` | 3,770,822 字节；`4573eee51e6180e6d3c5c81d8cad9f3d17895728363163b268f7338fb2f4e602` | 124,928 字节；`76815f67392b18811762ce150af7ae2a688e29f3ff40734bcabba6e71b938d48` |

66 的标准备份脚本最初因旧库尚无 `scope_manifests` 表而停止。生产没有提前建表，也没有跳过备份；本次使用审阅后的旧库兼容副本完成联合备份，并额外保存当前环境文件、Compose 和 Caddy 配置。

隔离恢复演练在切换后补做，两端均通过并自动清理临时数据库和临时卷：66 恢复 6 个关键表和 21 个 MinIO 文件，RTO 2.266 秒；201 恢复 6 个关键表和 47 个 MinIO 文件，RTO 15.256 秒。结果分别保存在对应备份目录的 `restore-drill-result.json`。本次顺序偏离了“切换前完成恢复演练”的理想门禁，下一版本升级必须在 Canary 切换前完成恢复演练。

## 5. 切换过程

1. 66 先执行基础设施 Canary；确认 Node 22.14.0、pnpm 11.21.0、生产配置和候选源码身份。
2. 66 切换后验证 `/ready`、`/api/version`、容器健康、数据库初始化和 Worker 重连。
3. 66 稳定窗口内保持健康且活动任务为 0，才开始 201 切换。
4. 201 重新执行生产部署验证和 Compose 配置检查。
5. 201 非交互 Docker 构建遇到凭据会话错误，生产容器未被替换。随后核对已加载候选镜像内嵌的 version、40 位 commit、builtAt 和 schemaVersion，确认一致后重新标记为正式 `0.2.5` 并使用 `--no-build` 切换。
6. 201 切换后对账关键表、Worker 心跳、CDP 席位和版本接口。

两端未同时执行首轮切换，任一预检失败时旧生产容器均保持运行。

## 6. 切换后证据

| 验证项 | 66 | 201 |
|---|---|---|
| `/ready` | 200 | 200 |
| `/api/version` | `0.2.5` / `bc61bac...` / `2026-08-17-p0.1` | `0.2.5` / `bc61bac...` / `2026-08-17-p0.1` |
| 容器健康 | Caddy、Master、Dashboard、PostgreSQL、Redis、MinIO 正常 | Caddy、Master、Dashboard、PostgreSQL、Redis、MinIO 正常 |
| 活动任务 | 0 | 0 |
| Worker/CDP | 本地 Worker 已重连；当时 CDP 席位为 0 | 4 个 Worker、10 个 CDP 席位已重连，最近心跳持续更新 |
| 数据对账 | 空控制面数据保持不变 | 切换前后：stores=7，store_runs=0，category_tasks=0，artifacts=0，price_quality_checks=0，notification_outbox=0 |
| 隔离恢复 | 通过；6 个关键表、21 个 MinIO 文件 | 通过；6 个关键表、47 个 MinIO 文件 |
| 局域网 Dashboard | 200 | 200 |

`candidate-verification.json` 已在两端记录 `activation=switched`、切换时间、备份目录、旧镜像和版本接口结果。

## 7. 回滚

1. 先确认新任务已经停止并处于安全断点。
2. 保存失败容器日志、版本接口结果和现场证据。
3. 使用本记录中的上一 Master/Dashboard 镜像和备份目录恢复，不执行 `down -v`。
4. Profile、Worker identity、spool、checkpoint、未上传 artifact 和旧源码目录保持原位。
5. 回滚后重新验证 `/ready`、只读 Dashboard、关键表行数、对象证据和 Worker 心跳。

## 8. 已知升级工具问题

1. `backup-master.ps1` 对旧库新增表缺少兼容判断。下一修复版应只统计实际存在的旧表，同时记录缺失表，不能把“新表尚未创建”当成备份失败。
2. `start-standalone-node.ps1` 需要固定使用候选准备阶段的 Node 22，并在非交互环境设置 CI 模式，避免错误使用系统 Node 24 或因无 TTY 中止依赖检查。
3. Windows Docker Desktop 在 SSH 非交互会话可能无法读取桌面凭据。升级工具应优先使用已验证本地镜像或独立无凭据 Docker 配置，并把镜像身份校验作为门禁。

这些问题影响自动升级工具的可重复性，不改变当前已运行容器的版本身份和健康结果。修复后应发布新 Patch 版本，不覆盖 `v0.2.5`。

## 9. 当前未完成门禁

- 真实账号、真实门店小类目 Canary。
- 验证码、403、418 的钉钉通知与人工恢复闭环。
- 正式全量批次、原始 artifact、质量门、Excel/数据库读回。
- 新人按 `docs/handoff/15-新人演练与独立操作验收.md` 完成 L3/L4 独立接管。

因此可以声明“66/201 已正式切换到 v0.2.5，基础设施与控制面验证通过”，不能据此声明“真实门店采集和新人独立交接已经完成”。

## 10. Codex 固定检查

1. 读取本记录和 `docs/handoff/02-Codex固定阅读与操作顺序.md`。
2. 现场核对 `/ready`、`/api/version`、容器镜像和活动任务。
3. 核对节点职责、Worker、Browser Slot、账号、Profile、CDP 和门店绑定。
4. 核对最新 checkpoint、artifact versionId/SHA-256、风险事件和人工待办。
5. 当前证据与本记录不一致时，停止生产动作，保留证据并更新交接状态。

本记录不得包含明文 Token、手机号、身份证生日、Cookie、验证码、Webhook 或数据库密码。
