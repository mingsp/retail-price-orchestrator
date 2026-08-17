# 从这里开始：商圈比价采集系统交接

这份项目用于调度多台 Worker 设备上的 Chrome/CDP，按账号和类目分工低频采集即时零售门店商品原始数据，并在验证码、登录异常和平台限制出现时进入人工处理闭环。

新人要从 0 到 1 执行一个完整门店时，先填写并复制根目录 `START_WITH_THIS_PROMPT.md` 的开篇
提示词。不要从一句“开始采集”进入生产操作。

## 先不要做什么

首次接手时不要：

- 启动真实采集。
- 连接或刷新现有 CDP 页面。
- 修改账号、Profile 或门店绑定。
- 删除旧 Profile、checkpoint 或原始文件。
- 写数据库或发送钉钉消息。
- 根据旧 IP、旧端口或旧手机号猜测当前资源。

## 固定阅读顺序

1. `AGENTS.md`
2. `docs/2026-08-11-Retail-Radar方案对抗式审查与会话交接.md`
3. `docs/2026-08-11-Retail-Radar生产级后端与智能值守补强方案.md`
4. 在 201 Master 上接管时，先阅读 `docs/operations/2026-08-11-201-master-blocker-remediation.md`
5. 再阅读 `docs/operations/2026-08-11-201-master-migration-verification.md`
6. 新建 201 Codex 会话时，复制 `docs/operations/201-codex-startup-prompt.md`
7. 当前钉钉台账、账号分配和登录准备阅读 `docs/operations/2026-08-12-钉钉台账与账户登录准备.md`
8. `docs/operations/2026-08-10-master-201-codex-handoff.md` 只作为历史快照阅读
9. 准备真实门店任务时，再填写并阅读 `START_WITH_THIS_PROMPT.md`
10. `docs/handoff/00-项目目标与边界.md`
11. `docs/handoff/01-系统架构与数据流.md`
12. `docs/handoff/02-Codex固定阅读与操作顺序.md`
13. `docs/handoff/04-设备账号Profile-CDP门店绑定.md`
14. `docs/handoff/05-任务规划与低频采集SOP.md`
15. `docs/handoff/07-风险事件与人工处理.md`
16. `docs/handoff/14-账号风控Profile与登录操作手册.md`
17. `docs/handoff/15-新人演练与独立操作验收.md`
18. `docs/handoff/16-Codex提示词手册与模板.md`
19. `docs/handoff/08-原始数据质量与完整性验收.md`
20. 其余 `docs/handoff/` 文档

### 私有独立单店节点

当接管已经部署的私有独立单店节点时，上述通用材料前还必须依次阅读该节点包内的：

1. `docs/operations/66-final-handoff.md`
2. `docs/operations/66-xcgjz-single-store-execution-handoff.md`
3. `docs/operations/2026-08-13-66-xcgjz-independent-migration.md`
4. `docs/operations/66-requirement-decision-index.md`
5. `docs/operations/66-current-thread-original-user-prompts-sanitized.md`
6. `docs/operations/66-xcgjz-codex-complete-prompt.md`

原始提问库只用于恢复需求演变和纠偏上下文，不构成采集、登录、通知或写库授权。

其中第 4、5 项是 201 当前生产事实和剩余门禁的入口。它们明确区分“已修复、待人工登录、
待 Canary 验证”，并列出会造成假完成、重复任务和资产证据丢失的 P0 阻断项。下一会话不得
跳过这两份文档直接实施主方案。

## 第一次离线演练

在项目根目录执行：

```powershell
node handoff/scripts/verify-package.mjs --package-root .
node handoff/scripts/verify-redaction.mjs --package-root .
node handoff/scripts/verify-doc-links.mjs --package-root .
node handoff/scripts/replay-sample.mjs --package-root .
```

如果当前是源码仓库而不是发布包，执行：

```powershell
pnpm handoff:test
node handoff/scripts/doctor.mjs --json
```

这些命令默认不连接真实 CDP、不启动 Chrome、不采集。

本次 P0 生产加固和当前验证边界先阅读 `docs/operations/2026-08-17-production-closure-report.md`；准备 66/201 无覆盖升级时再阅读 `docs/operations/2026-08-17-github-66-201-release-handoff.md`。

## 第一次现场检查

离线检查通过后，只读核对：

1. Master 健康和依赖状态。
2. Worker 实际在线状态和最后心跳。
3. Browser Slot、账号、Profile、CDP 和门店绑定。
4. 页面标题、门店 ID、登录状态和风险状态。
5. 当前任务、lease、checkpoint 和已有 artifact。

输出一份“已确认、未确认、需要人工提供”的清单，再决定是否执行 Canary。

## 第一次真实动作

只能从一个健康账号、一个纯采集 Profile、一个正确门店和一个小类目开始。Canary 必须验证：

- 原始 JSONL 正常追加。
- checkpoint 可恢复。
- 商品名称和嵌套 SKU 完整。
- 前端展示价来源可解释。
- 风险事件可以阻断任务。
- 质量审计通过。

Canary 通过后才能扩大到同门店其他类目或多个 Worker。

## 当前事实边界

- 2026-08-11 的迁移验收事实以 `docs/operations/2026-08-11-201-master-migration-verification.md` 为准；
  当前 `5 + 5` 登录拓扑、账号分配和剩余门禁以
  `docs/operations/2026-08-12-钉钉台账与账户登录准备.md` 为准。
- 当前生产采集器是 `project/scripts/native-cdp-store-capture.mjs`。
- SSH 只用于安装、升级和故障维护，不承担日常调度。
- Worker 执行确定性脚本；Codex 在 Master 侧负责巡检、异常理解和白名单操作。
- 原始数据先保存，后续再结构化、导出和入库。
- 发布包中的脱敏样例只用于演练，不能作为生产数据。
- 钉钉“商圈比价生产台账”是登记事实源；201 的定时任务只做 dry-run 校验。Codex 必须实时读取
  DWS，显式对账并获得授权后才能 publish，不能把旧文档当成表格当前内容。

## 遇到问题

先查：

- `docs/handoff/07-风险事件与人工处理.md`
- `docs/handoff/14-账号风控Profile与登录操作手册.md`
- `docs/handoff/16-Codex提示词手册与模板.md`
- `docs/handoff/11-故障案例和禁止重踩事项.md`
- `docs/handoff/12-已验证与待现场验证能力.md`

不要用连续重试来“试出来”。外部页面和账号状态不稳定时，保留断点和证据比继续请求更重要。
