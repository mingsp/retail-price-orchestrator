# 商圈比价数据采集调度系统

面向即时零售业务的多设备、多账号数据采集系统。系统统一安排门店和类目任务，持续记录账号、Profile、CDP、采集进度与异常状态，在需要验证码或人工确认时保留断点，最终交付可核验的门店原始商品数据。

**项目标签：** `采集` `调度` `风控` `数据` `部署` `文档`

[![CI](https://github.com/codewith1024/retail-price-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/codewith1024/retail-price-orchestrator/actions/workflows/ci.yml)

> 新同事先阅读 [交接入口](./HANDOFF_START_HERE.md)，再填写并使用 [开篇提示词](./START_WITH_THIS_PROMPT.md)。

## 业务目标

系统要稳定回答四个问题：

| 业务问题 | 系统给出的结果 |
|---|---|
| 谁在采什么 | 门店、类目、设备、CDP、Profile、账号和归属人一一对应 |
| 采到哪里 | 只按实际类目和商品数据计算进度，不使用预估 100% |
| 为什么停 | 区分验证码、登录失效、403/418、Worker 离线和数据质量问题 |
| 数据在哪 | 原始 JSONL、断点、质量结果和导出产物统一归档并可追溯 |

最终目标是完整获取门店商品事实数据。商品匹配、价格对比和调价建议属于后续业务处理，不在采集过程中改写原始数据。

## 业务流程

1. 登记 Worker、CDP、纯采集 Profile、授权账号、账号归属人和目标门店。
2. 按门店创建采集批次，把类目固定分配给不同账号，避免重复采集。
3. Worker 领取带租约的类目任务，在已登录页面中低频执行并持续保存断点。
4. 验证码、登录或访问异常只暂停受影响账号，通知对应人员处理；其他账号继续运行。
5. 采集结果先保存为原始 JSONL，再上传对象存储并执行类目、SPU、SKU 和价格字段质量检查。
6. 质量门通过后生成 Excel 或投影到业务数据库；未通过的批次保持“待补采”，不能显示完成。

## 系统组成

- **Master 调度中心**：管理门店批次、类目分工、任务租约、进度、风险事件和数据产物。
- **Worker 执行端**：运行在运营电脑上，管理 Chrome CDP/Profile，执行采集并回传心跳、断点和原始数据。
- **统一工作台**：展示真实门店进度、设备与账号状态、实时采集摘要、人工待办和数据结果。
- **人工与 Codex 值守**：运营人员处理登录和验证码；Master 侧 Codex 可辅助判断异常、恢复断点和生成处置建议。固定调度仍由系统完成。

日常任务通过 Worker 主动连接 Master；SSH 只用于安装、升级和故障维护。

## 技术栈

本项目的核心是后端 Master-Worker 调度和原始数据生产链路，前端工作台用于业务操作与状态查看。

### 核心后端与数据基础设施

| 模块 | 技术 | 业务作用 |
|---|---|---|
| 服务运行时 | Node.js 22、TypeScript、pnpm workspace | 统一 Master、Worker 和共享模型的开发与发布 |
| Master 调度服务 | Fastify 5、WebSocket | 分配类目任务、控制租约、接收心跳、回报进度和处理人工操作 |
| Worker 执行服务 | Node.js、WebSocket、Chrome CDP | 管理浏览器会话，执行低频采集，保存断点并上传原始产物 |
| 调度事实库 | PostgreSQL | 保存门店批次、任务、账号绑定、进度、风险、质量和审计记录 |
| 实时协作状态 | Redis | 保存 Worker 心跳、短期状态和调度事件 |
| 原始数据资产 | MinIO / S3、JSONL | 长期保存商品原始数据、截图、checkpoint 和质量证据 |
| 业务数据投影 | MySQL | 按下游字段需求生成商品与价格快照，不替代原始事实 |
| 生产部署 | Docker Compose、Caddy | 统一部署 Master、工作台、数据库、缓存和对象存储 |
| 通知与可观测性 | 钉钉 Webhook、Prometheus 格式指标、结构化日志 | 通知人工处理，并定位任务、设备和数据异常 |
| 可靠性机制 | 任务租约、fencing、checkpoint、有界执行池、幂等写入 | 防止重复领取、错误续采、资源失控和数据重复 |

### 操作台与工程质量

| 模块 | 技术 | 业务作用 |
|---|---|---|
| 统一工作台 | React 19、TypeScript、Vite、Tailwind CSS、TanStack Query、Lucide Icons | 查看真实门店进度、账号状态、实时摘要、风险待办和数据结果 |
| 自动验证 | Node Test Runner、TypeScript、GitHub Actions | 执行测试、类型检查、生产构建和公开安全检查 |

## 关键能力

- 一个门店可由多个账号按类目分工，任务不会被重复领取。
- Worker 离线或租约过期后可从 checkpoint 迁移，不从零重采。
- CDP 标识页记录端口、脱敏账号、归属人和目标门店，降低多窗口混淆。
- 门店位置和 `poi_id_str` 在开采前复核，避免采错门店。
- 使用页面真实上下文和动态数据块，减少无效点击与重复请求。
- 验证码、403/418、Profile 污染和账号异常进入统一人工处理队列。
- 原始数据优先保存，结构化失败不会导致采集事实丢失。
- 进度、商品数量和完成状态均来自实际数据与质量门，不写假数据。

## 快速检查

### 环境要求

- Node.js 22
- pnpm 11.21.0
- PowerShell 7（Windows Worker）或 Bash（Linux/macOS）
- Docker Desktop 或 Docker Engine

```powershell
git clone https://github.com/codewith1024/retail-price-orchestrator.git
cd retail-price-orchestrator
corepack enable
pnpm install --frozen-lockfile
pnpm handoff:test
node handoff/scripts/doctor.mjs --json
```

这些命令只做离线检查，不连接真实 CDP、不启动采集、不写生产数据库。

## 本地启动

```powershell
Copy-Item .env.example .env
docker compose -f infra/docker-compose.yml up -d
pnpm dev:master
pnpm dev:worker
pnpm dev:dashboard
```

工作台默认地址：`http://127.0.0.1:2808/`。真实采集前必须完成账号、Profile、CDP、门店和位置预检。

## 新人操作入口

1. [交接入口](./HANDOFF_START_HERE.md)
2. [开篇提示词](./START_WITH_THIS_PROMPT.md)
3. [设备、账号、Profile、CDP 与门店绑定](./docs/handoff/04-设备账号Profile-CDP门店绑定.md)
4. [任务规划与低频采集 SOP](./docs/handoff/05-任务规划与低频采集SOP.md)
5. [风险事件与人工处理](./docs/handoff/07-风险事件与人工处理.md)
6. [原始数据完整性验收](./docs/handoff/08-原始数据质量与完整性验收.md)

## 常见异常

| 现象 | 业务处理 |
|---|---|
| 验证码或身份核验 | 暂停该账号任务，保留页面和断点，通知归属人处理 |
| 403/418 | 停止连续刷新，判断账号、Profile、设备或网络影响范围 |
| Profile 污染 | 隔离旧 Profile，新账号使用全新的纯采集 Profile |
| Worker 离线 | 保留租约和断点，设备恢复后续采或迁移到健康 Worker |
| 页面显示完成但数据不全 | 按类目、SPU、SKU、价格和原始产物重新验收并补采 |

详细处置见 [账号、Profile 与登录操作手册](./docs/handoff/14-账号风控Profile与登录操作手册.md) 和 [禁止重踩事项](./docs/handoff/11-故障案例和禁止重踩事项.md)。

## 数据产物

```text
页面真实数据
  -> 原始 JSONL
  -> checkpoint 与类目证据
  -> MinIO / S3 原始产物
  -> 类目、SPU、SKU、价格质量验收
  -> Excel 或 MySQL 业务投影
```

## 开发验证

```powershell
pnpm handoff:test
pnpm typecheck
pnpm test
pnpm build:production
```

## 更多文档

- [系统架构与数据流](./docs/handoff/01-系统架构与数据流.md)
- [环境安装与诊断](./docs/handoff/03-环境安装与诊断.md)
- [部署、升级、回滚与备份](./docs/handoff/10-部署升级回滚与备份.md)
- [已验证与待现场验证能力](./docs/handoff/12-已验证与待现场验证能力.md)
- [Codex 提示词手册](./docs/handoff/16-Codex提示词手册与模板.md)
- [安全说明](./SECURITY.md)
- [贡献指南](./CONTRIBUTING.md)
- [变更记录](./CHANGELOG.md)
