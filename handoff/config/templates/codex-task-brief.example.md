# Codex 采集任务简报

## 任务目标

- 批次：`<RUN_ID>`
- 目标门店：`<STORE_ID / STORE_ALIAS>`
- 采集范围：`<FULL_STORE / CATEGORY_LIST>`
- 完成时间：`<TIME_WINDOW>`
- 交付产物：`raw JSONL / checkpoint / progress / summary / quality audit`

## 资源绑定

资源真相来源：`<MASTER_CONFIG_OR_BATCH_ID>`

| Worker | Browser Slot | 脱敏账号 | Profile | CDP | 目标门店 | 当前状态 |
|---|---|---|---|---|---|---|
| `<WORKER_ID>` | `<SLOT_ID>` | `<ACCOUNT_ALIAS>` | `<PROFILE_ID>` | `<CDP_ID>` | `<STORE_ID>` | `<STATUS>` |

## 类目分工

类目计划：`<CATEGORY_PLAN_ID>`

- `<ACCOUNT_ALIAS_1>`：`<CATEGORY_SET_1>`
- `<ACCOUNT_ALIAS_2>`：`<CATEGORY_SET_2>`

## 已有断点

- checkpoint：`<CHECKPOINT_ID>`
- 已完成类目：`<COMPLETED_CATEGORIES>`
- 最近成功类目：`<LAST_SUCCESS_CATEGORY>`
- 原始数据 artifact：`<RAW_ARTIFACT_ID>`
- 已知缺口：`<KNOWN_GAPS>`

## 安全边界

- 本任务已获得授权。
- 使用批准的低频策略。
- 不绕过验证码、身份核验或平台限制。
- 不连续刷新 403/418 页面。
- 不复制 Cookie、UUID、旧请求参数或深页游标。
- 已有有效数据不得从零重采。
- 风险时暂停受影响 Slot，保留断点和证据。

## 当前人工状态

- 登录：`<CONFIRMED / PENDING / UNKNOWN>`
- 验证码：`<NONE / MANUAL_REQUIRED / RESOLVED>`
- 403/418：`<NONE / RISK_EVENT_ID>`
- 需要人工操作：`<ACTION>`

## 完成标准

- 所有有效类目都有原始证据或明确排除原因。
- raw JSONL 可解析。
- SPU、嵌套 SKU 和门店唯一 SKU 已对账。
- 商品名称保持原文。
- 展示价字段来源和覆盖率已审计。
- checkpoint、summary、artifact SHA-256 一致。
- 风险事件已关闭、隔离或升级。

## 给 Codex 的动作

先只读恢复和核对以上信息。输出“已确认、未确认、阻断项和建议下一步”。只有资源绑定、
门店和断点一致后，才能按批准范围执行。
