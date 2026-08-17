# 2026-08-17 P0 生产闭环报告

## 1. 结论

Retail-Radar 0.2.5 已完成本机 L0～L2 的 P0 数据真相、可靠恢复、故障降级、版本识别和无覆盖交接能力验证。系统不再以 Worker 自报完成、Dashboard 百分比或单一 Excel 行数作为完成依据，而由 Master 结合冻结范围、任务状态、对象版本、SHA-256、原始行数、展示价覆盖和类目完成事实裁决。

66 与 201 已在独立目录完成 `v0.2.5` 候选验证，并于 2026-08-17 按 66 Canary、稳定窗口、201 第二节点的顺序切换生产服务。两端基础设施和控制面验证通过，但真实小类目、正式全量批次和新人独立接管仍属于 L3～L4 现场门禁。

## 2. 技术栈为什么保留

| 技术 | 解决的业务故障 | 缺少它会发生什么 | 当前加固 |
|---|---|---|---|
| PostgreSQL 16 | 保存批次、类目、租约、账号绑定、质量和交付的唯一事实 | 多 Worker 重复领取、页面显示与真实状态分裂 | 批次业务唯一键、规范类目唯一键、状态前置条件、租约 generation、冻结范围外键 |
| Redis 7 | 低延迟 WebSocket 事件分发和可重建实时态 | 页面刷新慢，但不应破坏任务真相 | Redis 失效时 `/ready` 阻断扩容，PostgreSQL 控制面仍可读，恢复后自动重连 |
| MinIO/S3 | 保存完整原始 JSONL、截图、日志和 Excel | 数据库字段变化后无法从原始证据重放 | 对象版本、SHA-256、同键冲突拒绝、冻结交付引用固定 versionId |
| SQLite WAL | Worker 在 Master/网络短时不可用时保存待送事件 | 风险/错误事实只在内存，进程退出即丢 | `synchronous=FULL`、跨进程原子领取、指数退避、死信；采集流水线由 raw/checkpoint 恢复 |
| WebSocket | Worker 心跳和操作台实时摘要 | 运营无法及时知道哪个账号、CDP、类目遇阻 | 独立 Worker 凭据、连接指标；调度真相仍以 PostgreSQL 为准 |
| MySQL | 面向下游比价的可重建投影 | 把业务清洗规则污染原始采集事实 | 原始数据先冻结，MySQL/Excel 只作为可重放派生结果 |
| 有界执行池 | 在多账号并发时限制设备内存和事件循环压力 | 无界并发导致 Chrome/Worker 同时失效 | 资源感知、队列上限、96% 前不盲目降并发、99% 保护停机 |
| Prometheus | 让故障在业务损失前被发现 | 只能靠人盯日志，通知死信和证据缺失长期不可见 | Worker 新鲜度、租约冲突、质量失败、通知死信、对象证据、未冻结范围告警 |
| Docker Compose + Caddy | 固定运行依赖、网络边界、HTTPS/WSS 单入口 | 主机差异导致“这台能跑、换台就坏” | 固定镜像、后端网络不暴露、版本和 commit 写入镜像、Caddy 唯一入口 |
| Codex Master 值守 | 处理 403/418/验证码、断点判断等非固定异常 | 固定脚本只能重复失败，无法理解现场上下文 | Codex 不在 Worker；脚本负责确定性执行，Codex 只做审计、异常分类和白名单恢复 |

## 3. P0 数据真相

- 批次唯一性：`channel + store + schedule_window + scope_version` 生成稳定业务键。
- 类目唯一性：`run_id + canonical_category_key` 数据库唯一。
- 采集范围：类目和优惠范围先冻结为 `scope_manifest`，无范围的活动批次不能交付。
- 状态真相：只有 Master 能写 `completed_valid`；Worker 只能上报事实。
- 账号门禁：未进入账号池、冷却中、高风险、错 Worker/门店/Profile/CDP 的账号不能 Claim。
- 进度分母：冻结类目数，而不是预估 SKU 数或固定 100%。
- 原始证据：同对象键只允许同 checksum、同 version 的幂等重放，内容变化必须新建版本。

## 4. P0 可靠恢复

- Worker 异步事件使用 SQLite WAL；跨进程只能有一个领取者，失败按上限进入死信。
- 商品采集流水线通过本地 raw、progress、checkpoint 和 Master 幂等接口恢复，不从 0 重采。
- 任务暂停或迁移会撤销旧租约并增加 generation；旧 Worker 的迟到写入返回 409。
- 通知使用独立 outbox，`outcome_unknown` 和 `dead_letter` 阻断生产就绪。
- PostgreSQL 与 MinIO 同时备份；恢复只进入隔离数据库和临时卷。

## 5. 当前验证证据

验证日期：2026-08-17，环境：本机隔离 PostgreSQL/Redis/MinIO 与 Master 测试端口。

| 验证项 | 结果 | 关键证据 |
|---|---|---|
| 双 Worker E2E | 通过 | A 领取、暂停、迁移 B、旧 generation 返回 409、B 完成 raw/结构化/质量/冻结/Excel |
| Redis 故障 | 通过 | 暂停时 health=200、ready=503、控制面=200；恢复后 ready=200 |
| MinIO 故障 | 通过 | 暂停时 health=200、ready=503、控制面=200；恢复后 ready=200 |
| 联合备份 | 通过 | activeTasks=0；PostgreSQL dump 和 MinIO 版本卷均有 SHA-256 |
| 隔离恢复 | 通过 | 7 个关键表行数一致，MinIO 1,736 个文件一致 |
| 恢复性能 | 通过 | RTO 58.256 秒；演练执行时 RPO 年龄 495 秒 |
| 测试/类型/构建/脱敏 | 通过 | 固定 commit 后再次执行，全部退出 0；公开扫描 437 个文件、422 个文本文件，敏感信息发现 0 |
| 干净 Docker 构建 | 通过 | Master 与 Dashboard 均从默认拒绝的 Docker 上下文构建；修复并门禁化类目证据模块及类型声明依赖 |
| 签名 Worker 发布 | 通过 | Windows、macOS arm64、macOS x64 三个平台包由 201 上的 Ed25519 私钥签名并逐个平台验签 |
| 远端生产切换 | 通过 | 66/201 均运行 `0.2.5`；版本接口、健康状态、旧镜像回滚目标、联合备份、Worker 重连和关键表对账已记录 |

恢复实测是本机样本容量结果，不是未来大数据量的 SLA 承诺。生产 RPO 由备份频率决定，建议日常每 6 小时增量、每日完整、每周隔离恢复演练。

## 6. 生产就绪门禁与当前状态

以下门禁用于切换 66/201。第 1、2、4、5 项在切换前完成；第 3 项的联合备份在切换前完成，隔离恢复在切换后补做并通过，属于已记录的流程偏差。第 6～7 项仍决定真实采集和独立交接是否可以宣布完成：

1. 固定 Tag 与 40 位 commit 已推送 GitHub。
2. 最终 `handoff:test`、`typecheck`、`test`、`build:production`、`public:verify` 全部退出 0。
3. 发布前 PostgreSQL/MinIO 备份和隔离恢复通过。
4. 66 与 201 各自在新版本目录完成离线验证，现有目录未删除。
5. 单节点 Canary 稳定在线，版本接口、任务、artifact 和回滚目标一致。
6. 真实小类目验证完成，风险事件可人工处理并从 checkpoint 续采。
7. 新人验收 JSON 通过 `pnpm acceptance:verify`，并由现场负责人复核。

## 7. 当前生产状态与剩余现场项

- GitHub 固定发布为 `v0.2.5` / `bc61bacf316ca6139973984fd6ed803537f3bb09`。
- 201 和 66 的固定 Codex 项目入口均为 `D:\SpanAI\retail-price-orchestrator`，后续升级不得改变。201 的生产内部版本化源码位于 `D:\SpanAI\retail-radar-master\sources\v0.2.5`；66 的生产内部版本化源码位于 `C:\ProgramData\RetailRadar\Standalone\sources\v0.2.5`。
- 两端均记录 `candidate_verified`、`activation=switched`、Node 22.14.0、pnpm 11.21.0；旧源码目录和旧镜像仍保留。
- 两端 Master/Dashboard 已运行 `0.2.5`，`/ready` 和 `/api/version` 验证通过；201 的 4 个 Worker 和 10 个 CDP 席位已重新连接。
- PostgreSQL/MinIO 备份、哈希、旧镜像和切换后数据对账见 `docs/operations/2026-08-17-github-66-201-release-handoff.md`。
- 两端实际备份的隔离恢复均通过；本次恢复演练发生在切换后，下一次升级必须前移到 Canary 之前。
- 真实账号、真实门店、验证码通知和远程桌面仍需现场 Canary。
- 新人 L3/L4 尚需实名签字验收。

当前可以声明“66/201 已切换到 v0.2.5，基础设施与控制面验证通过”。剩余项完成前不得宣称“真实门店全量采集闭环或新人独立交接完成”。
