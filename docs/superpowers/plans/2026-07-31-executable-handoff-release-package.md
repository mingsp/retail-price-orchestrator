# 商圈比价可执行交接发布包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This project explicitly forbids subagents, so all steps run inline in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成一个无账号会话和密钥、可由新 Codex 从唯一入口理解、可离线回放并可自动验收的商圈比价完整交接发布包。

**Architecture:** 在现有 `retail-price-orchestrator` 中新增独立 `handoff/` 工具与 `docs/handoff/` 真相文档，不修改采集核心算法。发布构建器从当前工作树收集 tracked 与 non-ignored 源码，白名单复制交接资产，从真实运行目录抽取少量记录并稳定脱敏，生成 Manifest、SHA-256、验证报告和 ZIP，随后在全新目录解压复验。

**Tech Stack:** Node.js 22、原生 `node:test`、PowerShell 7/Windows PowerShell 兼容打包入口、pnpm workspace、JSON/JSONL、SHA-256、PowerShell `Compress-Archive`。

---

## 文件结构

### 新建

- `AGENTS.md`：新 Codex 强制操作边界。
- `HANDOFF_START_HERE.md`：唯一交接入口。
- `docs/handoff/00-项目目标与边界.md`
- `docs/handoff/01-系统架构与数据流.md`
- `docs/handoff/02-Codex固定阅读与操作顺序.md`
- `docs/handoff/03-环境安装与诊断.md`
- `docs/handoff/04-设备账号Profile-CDP门店绑定.md`
- `docs/handoff/05-任务规划与低频采集SOP.md`
- `docs/handoff/06-断点恢复与跨Worker迁移.md`
- `docs/handoff/07-风险事件与人工处理.md`
- `docs/handoff/08-原始数据质量与完整性验收.md`
- `docs/handoff/09-Excel导出与数据库入库.md`
- `docs/handoff/10-部署升级回滚与备份.md`
- `docs/handoff/11-故障案例和禁止重踩事项.md`
- `docs/handoff/12-已验证与待现场验证能力.md`
- `docs/handoff/13-资产来源与替代关系.md`
- `handoff/config/templates/*.example`
- `handoff/lib/files.mjs`：安全文件枚举、复制、哈希和 JSONL 工具。
- `handoff/lib/redaction.mjs`：稳定脱敏和敏感模式扫描。
- `handoff/lib/sample.mjs`：真实样例抽取、字段投影和预期审计。
- `handoff/scripts/doctor.mjs`
- `handoff/scripts/verify-package.mjs`
- `handoff/scripts/verify-redaction.mjs`
- `handoff/scripts/replay-sample.mjs`
- `handoff/scripts/verify-doc-links.mjs`
- `handoff/scripts/build-package.mjs`
- `handoff/scripts/build-package.ps1`
- `handoff/test/redaction.test.mjs`
- `handoff/test/sample-replay.test.mjs`
- `handoff/test/package-filter.test.mjs`

### 修改

- `.gitignore`：排除 `handoff/releases/`、`handoff/work/`。
- `package.json`：增加 `handoff:test`、`handoff:build`、`handoff:verify`。
- `README.md`：增加交接入口，不改变现有运行说明。

## Task 1：建立交接工具测试基线

**Files:**
- Create: `handoff/test/redaction.test.mjs`
- Create: `handoff/test/sample-replay.test.mjs`
- Create: `handoff/test/package-filter.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: 写脱敏失败测试**

断言手机号、钉钉 access token、Cookie、Authorization、Windows 用户目录、macOS 用户目录、私钥头和真实 `.env` 会被识别；占位符和 `sample-*` 不报错。

- [ ] **Step 2: 写样例回放失败测试**

构造含重复 SPU、多 SKU、活动价、断点和风险事件的内存样例，断言审计结果包含：

```json
{
  "rawRows": 4,
  "uniqueSpu": 3,
  "uniqueSku": 4,
  "frontDisplayPriceCoverage": 1,
  "riskEvents": 1,
  "checkpointCompletedCategories": 1
}
```

- [ ] **Step 3: 写包过滤失败测试**

断言 `.git`、`.runtime`、`node_modules`、`dist`、Profile、`.env`、JSONL、XLSX 和 release 自身不会进入 `project/` 源码快照，同时 tracked/non-ignored 源码可以进入。

- [ ] **Step 4: 运行测试确认失败**

Run:

```powershell
node --test handoff/test/*.test.mjs
```

Expected: FAIL，因为 `handoff/lib/*.mjs` 尚不存在。

## Task 2：实现安全文件与脱敏核心

**Files:**
- Create: `handoff/lib/files.mjs`
- Create: `handoff/lib/redaction.mjs`
- Create: `handoff/lib/sample.mjs`
- Test: `handoff/test/*.test.mjs`

- [ ] **Step 1: 实现文件枚举**

`listSourceFiles(repoRoot)` 调用：

```text
git ls-files -co --exclude-standard -z
```

再执行显式拒绝规则，返回排序后的 POSIX 相对路径；禁止跟随目录联接和符号链接到仓库外部。

- [ ] **Step 2: 实现复制和哈希**

提供 `copyFileSafe`、`sha256File`、`writeJsonAtomic`、`readJsonl`、`writeJsonl`。复制前后检查路径仍位于允许根目录。

- [ ] **Step 3: 实现敏感扫描**

`scanText` 返回 `{ruleId, line, column, preview}`，preview 对命中值再次遮罩，不在报告中泄露秘密。

- [ ] **Step 4: 实现稳定脱敏**

`sanitizeCaptureRecord` 将 Worker、Slot、账号、Profile、门店、CDP 和路径映射为 `sample-*`；递归删除 Cookie、Token、Authorization、Webhook、请求流水和本机路径。

- [ ] **Step 5: 实现样例审计**

`auditSample` 从原始行展开嵌套 SKU，计算唯一 SPU/SKU、类目、展示价覆盖、风险和 checkpoint 完成类目。

- [ ] **Step 6: 运行单元测试**

Run:

```powershell
node --test handoff/test/*.test.mjs
```

Expected: PASS。

## Task 3：建立唯一入口和交接真相文档

**Files:**
- Create: `AGENTS.md`
- Create: `HANDOFF_START_HERE.md`
- Create: `docs/handoff/*.md`
- Modify: `README.md`

- [ ] **Step 1: 写唯一入口**

明确固定阅读顺序、禁止动作、离线演练、现场只读、Canary 和正式批次门禁。

- [ ] **Step 2: 写 Codex 约束**

覆盖不绕过验证码、不复用风险 Profile、不从零重采、不信假 100%、不泄露密钥、不删除原始资产和生产写入确认。

- [ ] **Step 3: 写架构与资源绑定文档**

说明 Master、Worker、Browser Slot、账号、Profile、CDP、门店、类目任务、lease、artifact 和 Codex 的职责。

- [ ] **Step 4: 写生产操作文档**

按“环境 -> 资源绑定 -> 任务规划 -> 低频采集 -> 断点恢复 -> 风险处理 -> 质量 -> 导出/入库 -> 升级回滚”完整描述。

- [ ] **Step 5: 写经验与证据边界**

将早期实验的成功策略和失败模式提炼成决策记录；标记历史文档为 `current/reference/superseded/evidence`。

- [ ] **Step 6: 检查文档占位符与冲突**

Run:

```powershell
rg -n "TBD|TODO|以后补|待定" HANDOFF_START_HERE.md AGENTS.md docs/handoff
```

Expected: 0 matches。

## Task 4：建立配置模板和环境诊断

**Files:**
- Create: `handoff/config/templates/master.env.example`
- Create: `handoff/config/templates/worker.env.example`
- Create: `handoff/config/templates/browser-slots.example.json`
- Create: `handoff/config/templates/stores.example.json`
- Create: `handoff/config/templates/notification.example.json`
- Create: `handoff/scripts/doctor.mjs`

- [ ] **Step 1: 写无秘密配置模板**

所有环境值为空或 `<PLACEHOLDER>`，账号使用脱敏标签，IP 使用文档保留地址或回环地址。

- [ ] **Step 2: 实现默认只读 doctor**

检查 Node、pnpm、Git、Chrome、Docker、磁盘、时钟、配置文件和端口格式；只有显式 `--network` 才检查网络，不连接 CDP、不启动 Chrome、不采集。

- [ ] **Step 3: 验证 doctor**

Run:

```powershell
node handoff/scripts/doctor.mjs --json
```

Expected: 返回结构化结果；可选组件缺失标为 warning，不打印环境变量值。

## Task 5：生成脱敏真实样例

**Files:**
- Modify: `handoff/lib/sample.mjs`
- Create during build: `examples/deidentified/*`

- [ ] **Step 1: 从指定运行根目录发现候选**

构建命令必须显式传入 `--sample-source-root`；不在源码中硬编码本机运行路径。

- [ ] **Step 2: 选择最小代表记录**

优先选择不同类目、包含多 SKU、存在活动展示价的 3～5 条原始商品；从 progress/checkpoint/risk 中选取正常、断点和风险事件。

- [ ] **Step 3: 生成稳定假身份**

写入 `sample-worker-01`、`sample-account-01`、`sample-profile-01`、`sample-store-01` 和 `sample-slot-01`。

- [ ] **Step 4: 写预期审计**

由脱敏后样例计算 `expected-audit.json`，不能手写与数据脱节的数字。

- [ ] **Step 5: 对样例执行二次敏感扫描**

任何命中立即终止构建，不生成可交付 ZIP。

## Task 6：实现发布构建与验证

**Files:**
- Create: `handoff/scripts/verify-redaction.mjs`
- Create: `handoff/scripts/replay-sample.mjs`
- Create: `handoff/scripts/verify-doc-links.mjs`
- Create: `handoff/scripts/verify-package.mjs`
- Create: `handoff/scripts/build-package.mjs`
- Create: `handoff/scripts/build-package.ps1`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: 实现发布目录构建**

创建临时目录，复制唯一入口、源码快照、交接文档、模板、脱敏样例和验证脚本。若目标 release 已存在，构建前只删除 `handoff/releases/<本次固定发布名>` 和对应临时目录，不触碰其他目录。

- [ ] **Step 2: 生成来源和文件清单**

`source-provenance.json` 记录源相对路径、大小和 SHA-256；`MANIFEST.json` 记录发布包全部文件。

- [ ] **Step 3: 实现文档链接检查**

只解析本地 Markdown 相对链接；外部 URL 不联网验证，绝对本机路径视为错误。

- [ ] **Step 4: 实现发布包验证**

检查必需文件、排除项、Manifest、SHA-256、脱敏结果和样例回放。

- [ ] **Step 5: 生成 ZIP**

PowerShell 包装器调用 Node 构建器，再使用 `Compress-Archive` 生成 ZIP 和 `.sha256`。构建器输出 JSON 报告。

- [ ] **Step 6: 执行工具测试**

Run:

```powershell
pnpm handoff:test
```

Expected: PASS。

## Task 7：验证当前项目源码

**Files:**
- Create during build: `reports/source-validation.json`

- [ ] **Step 1: 运行项目测试**

```powershell
pnpm test
```

- [ ] **Step 2: 运行类型检查**

```powershell
pnpm typecheck
```

- [ ] **Step 3: 运行生产构建**

```powershell
pnpm build:production
```

- [ ] **Step 4: 如实记录结果**

任何失败都保留命令、退出码和简短原因；不得把历史 177/177 报告替代为当前验证。

## Task 8：构建最终交接包并进行干净解压复验

**Files:**
- Create: `handoff/releases/retail-price-orchestrator-handoff-20260731/`
- Create: `handoff/releases/retail-price-orchestrator-handoff-20260731.zip`
- Create: `handoff/releases/retail-price-orchestrator-handoff-20260731.zip.sha256`

- [ ] **Step 1: 执行发布构建**

```powershell
pnpm handoff:build -- --sample-source-root "<本地运行根目录>"
```

- [ ] **Step 2: 验证目录包**

```powershell
node handoff/scripts/verify-package.mjs --package-root "handoff/releases/retail-price-orchestrator-handoff-20260731"
```

- [ ] **Step 3: 解压到全新临时目录**

目标限定为 `handoff/work/verify-unpacked-20260731`，解析后确认位于仓库的 `handoff/work` 内，再清理同名旧验证目录。

- [ ] **Step 4: 在解压目录复验**

运行包内 `scripts/handoff/verify-package.mjs`、`verify-redaction.mjs`、`verify-doc-links.mjs` 和 `replay-sample.mjs`。

- [ ] **Step 5: 校验 ZIP**

核对 `.sha256` 与重新计算值一致，记录大小和文件数。

- [ ] **Step 6: 更新计划和提交交接源码**

只暂存本计划涉及的源码、文档和模板；不提交 runtime、release、用户现有未提交修改和真实样例来源。

## 完成验收

- [ ] 设计规范 18 项要求均映射到任务。
- [ ] 无 `TBD/TODO/待定`。
- [ ] 单元测试通过。
- [ ] 当前项目测试、类型检查、生产构建结果已记录。
- [ ] 脱敏扫描零命中。
- [ ] 样例回放与预期审计一致。
- [ ] 目录包验证通过。
- [ ] ZIP 干净解压复验通过。
- [ ] 最终文件、SHA-256、未完成现场验证和使用入口已交付。

