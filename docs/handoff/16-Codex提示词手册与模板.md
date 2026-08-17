# Codex 提示词手册与模板

## 1. 这份手册解决什么问题

本手册根据项目真实采集协作过程提炼。新人需要学会把目标、资源绑定、断点、安全边界和完成
标准一次说清楚，让 Codex 能够正确检查、执行、暂停、恢复和验收。

Codex 在本项目中是 Master 侧智能值守者，不是验证码绕过工具，也不是资源真相来源。Master、
Worker、Browser Slot、Profile、账号、门店、checkpoint 和原始 artifact 才是事实。

如果目标是让新人从零完成一个门店，优先使用根目录 `START_WITH_THIS_PROMPT.md`。本手册用于
理解总提示词并处理后续分场景对话。

## 2. 一条合格提示词的六个部分

每次新任务或上下文恢复至少包含：

1. **目标**：采哪个门店、要全量还是指定类目、最终产物是什么。
2. **资源**：Worker、Browser Slot、脱敏账号、Profile、CDP 和门店绑定。
3. **当前状态**：已登录、待登录、已验证、403、离线或尚未确认。
4. **断点**：已有批次、已完成类目、最近 checkpoint、明确不能从零重采。
5. **安全边界**：授权、低频、不连续刷新、不绕过验证、风险时保留证据。
6. **完成标准**：类目、raw JSONL、SPU/SKU、展示价、checkpoint 和质量门如何验收。

不要把完整手机号、密码、短信验证码、Cookie、Webhook、Token、数据库密码、SSH 密钥或本机
绝对路径粘贴到提示词。使用 Master 中的资源 ID、脱敏账号和配置文件名称。

## 3. 会话使用方式

### 第一条必须完整

新会话、Codex 重启、任务转交或隔天恢复时，必须先发送完整“上下文恢复提示词”。Codex 应先
只读核对，不直接发请求。

### 后续可以简短

只有在本轮已经确认以下事实后，才能使用“继续”“已验证”“开始采集”等短提示：

- 当前 Worker 和 Slot。
- 当前账号和 Profile。
- 当前目标门店。
- 当前任务和 checkpoint。
- 当前风险是否解除。

否则短提示可能恢复错门店、错账号或从错误断点开始。

## 4. 模板 A：新人第一次接手

```text
这是商圈比价 Master-Worker 数据采集系统。请先只读理解，不启动 Chrome、不连接生产 CDP、
不采集、不写数据库。

请按顺序阅读：
1. AGENTS.md
2. HANDOFF_START_HERE.md
3. docs/operations/2026-08-17-github-66-201-release-handoff.md
4. docs/handoff/00-项目目标与边界.md
5. docs/handoff/04-设备账号Profile-CDP门店绑定.md
6. docs/handoff/05-任务规划与低频采集SOP.md
7. docs/handoff/07-风险事件与人工处理.md
8. docs/handoff/14-账号风控Profile与登录操作手册.md
9. docs/handoff/16-Codex提示词手册与模板.md

然后运行离线包验证和环境诊断。请输出：
- 已证明
- 尚未证明
- 需要现场人员提供
- 第一次 Canary 前的阻断项

不要把历史 IP、端口、账号状态或旧报告当作当前事实。
```

适用：第一次拿到交接包。

## 4.1 模板 A1：201 Master 当前生产接管

```text
请接管 Retail-Radar 201 Master。先只读核验，不创建任务、不启动 Chrome、不连接真实门店页面。

按顺序读取：
1. HANDOFF_START_HERE.md
2. docs/operations/2026-08-17-github-66-201-release-handoff.md
3. docs/handoff/02-Codex固定阅读与操作顺序.md
4. docs/handoff/10-部署升级回滚与备份.md
5. docs/handoff/12-已验证与待现场验证能力.md

当前正式基线应为 v0.2.5、commit bc61bacf316ca6139973984fd6ed803537f3bb09、
schema 2026-08-17-p0.1。请从 /ready、/api/version、容器、PostgreSQL、Worker 心跳和
Browser Slot 重新验证，不能只相信文档。

请输出：
- 当前生产版本是否一致
- 201 当前负责的门店边界
- Worker/CDP 当前在线事实
- 活动任务、风险事件和人工待办
- 最近可用备份和回滚目标
- 真实小类目 Canary 前仍缺少的条件

若当前证据与交接记录不一致，停止生产动作并报告差异。
```

适用：201 上新建 Codex 会话或完成版本升级后的首次接管。

## 5. 模板 B：新批次开始前只读检查

```text
我们准备执行一个新的授权采集批次，当前先不要采集。

目标门店：<STORE_ID / STORE_ALIAS>
目标范围：<全门店 / 类目列表>
期望产物：原始 JSONL、checkpoint、progress、summary、质量审计
计划完成时间：<TIME_WINDOW>

资源计划在 Master 配置 <CONFIG_OR_BATCH_ID> 中。请只读检查：
1. Worker、Browser Slot、账号、Profile、CDP、门店是否唯一绑定。
2. 账号和 Profile 是否健康，是否处于冷却或 D+1 待复检。
3. 是否存在旧 checkpoint、旧 raw 和未完成任务。
4. 类目分工是否重叠。
5. 网络、时间、磁盘和 Worker 心跳是否满足生产门禁。

输出一份“可开始、需人工处理、必须阻断”的清单。未确认门店 ID 前不得发商品请求。
```

适用：登录账号或开始任务之前。

## 6. 模板 C：账号已经人工登录

```text
账号 <ACCOUNT_ALIAS> 已由人工登录到 <WORKER_ID>/<SLOT_ID>。
Profile：<PROFILE_ID>
目标门店：<STORE_ID / STORE_ALIAS>

请不要因为“已登录”直接开始采集。先低频只读确认：
1. 标识页完整手机号、账号所属人和目标门店记录一致，并已点击“保存标识”。
   完整手机号只维护在本机标识页和包外私密账号映射；Master 只保存脱敏号。
2. Profile 是纯采集 Profile，没有商家后台登录。
3. 页面不是登录页、验证码、403、418 或空商品页。
4. 页面门店 ID 与任务一致。

确认后只执行一个小类目 Canary，并汇报 raw、checkpoint、SPU/SKU 和展示价检查结果。
```

适用：运营人员完成登录后。

## 7. 模板 D：开始全量采集

```text
现场预检和 Canary 已通过，可以开始 <STORE_ALIAS> 的正式采集。

批次：<RUN_ID>
资源绑定：读取 Master 中 <BINDING_CONFIG_ID>，不要按窗口顺序猜测。
类目分工：读取 <CATEGORY_PLAN_ID>，一个账号只采自己固定类目。
断点：使用 <CHECKPOINT_ID>；已有有效数据不能从零重采。

执行要求：
- 优先使用页面真实缓存、allSortedSpuId 和缺失 ID 补齐。
- 不固定每次 20 条，不频繁点击，不请求已落盘商品。
- 使用批准的低频参数和类目间休息。
- 验证码、403、418、登录失效或商品不可见时只停止受影响 Slot，保留断点并生成风险事件。
- 不绕过验证，不复制会话参数，不自动切换账号/Profile。

每个类目完成后汇报该类目新增原始 SPU、嵌套 SKU、请求数和有效缺口。
整体只在风险、50% 和质量门 100% 时通知钉钉。
```

适用：生产批次正式启动。

## 8. 模板 E：Codex 中断后恢复

```text
Codex 会话刚刚中断。不要从零开始，也不要立即触发页面请求。

请从 Master、Worker spool 和原始文件只读恢复上下文：
1. 当前运行批次和目标门店。
2. 每个任务绑定的 Worker/Slot/账号/Profile/CDP。
3. 每个类目的状态、最后成功时间和 lease。
4. 最新 checkpoint、raw JSONL 行数和已落盘商品 ID。
5. 当前是否有验证码、403、418、登录失效或 Worker 离线。

先输出恢复摘要和建议续采点。只有账号、门店、断点三者一致后，才从缺口继续，不重新采已有商品。
```

适用：Codex 退出、电脑重启或任务转交。

## 9. 模板 F：人工已完成验证码

```text
<WORKER_ID>/<SLOT_ID> 的验证已由人工完成。

请低频检查页面状态，不连续刷新。确认：
- 当前账号仍是 <ACCOUNT_ALIAS>。
- 当前门店仍是 <STORE_ID>。
- 商品页面已经可见。
- 原任务 checkpoint 未回退。

全部确认后先做一次小范围恢复 Canary，再从原 checkpoint 的有效缺口继续。
不要等待我重复说明已经验证，也不要恢复其他 Slot。
```

适用：滑块、短信或身份核验由人工处理后。

## 10. 模板 G：出现 403

```text
<WORKER_ID>/<SLOT_ID> 当前出现 403。立即停止该 Slot 新请求，其他健康 Slot 不受影响。

请保留页面、截图、checkpoint 和 raw，并按
docs/handoff/14-账号风控Profile与登录操作手册.md 分类：
- target_poi_block
- instant_retail_block
- product_interface_block
- account_block
- device_or_ip_risk

只允许一次人工批准的只读分类检查，不连续刷新、不换参数、不重打深页。
输出：证据、暂定分类、账号动作、Profile 动作、任务动作、复检时间和是否需要升级 Worker 风险。
```

适用：页面或接口出现 403/H403。

## 11. 模板 H：更换账号和 Profile

```text
风险事件 <RISK_EVENT_ID> 已确认需要更换账号和 Profile。

请按固定链路执行，先不要启动新账号采集：
1. 冻结旧 lease，校验旧 checkpoint 和 raw 哈希。
2. 将旧账号标记为 <cooldown/blocked/retired>。
3. 将旧 Profile 标记为 <profile_risk/retired>，保留审计，不删除。
4. 为备用账号 <NEW_ACCOUNT_ALIAS> 创建全新的纯采集 Profile 和唯一 Slot 绑定。
5. 不复制 Cookie、localStorage、UUID、旧参数、验证页和深页游标。
6. 等人工登录后再做首屏预检和小类目 Canary。
7. 只迁移类目计划、已完成类目、已落盘商品 ID 和 checkpoint 版本。

完成准备后，必须从包外私密账号映射读取并在当前直接任务中提醒：
- 更换后的完整手机号
- 账号所属人
- Worker/Slot/CDP
- 目标门店
- Master 中的脱敏标识

然后告诉我需要在哪个 Slot 人工登录。不要自动输入账号或验证码，不把完整手机号发到钉钉或日志。
```

适用：账号或 Profile 已确认不能继续。

## 12. 模板 I：三到五分钟采集摘要

```text
继续采集，不改变当前类目分工和低频策略。

请按简短格式汇报：
门店 | 完成类目/总类目 | 原始SPU | 嵌套SKU | 当前类目 | 最近成功时间 | 风险/人工待办

只报告真实证据：
- 未知总量显示“未知”，不要预估 100%。
- 区分门店唯一 SPU/SKU 和类目-商品关系数。
- 排除验证码等待等人工停滞时间后再计算速度。
- 没有变化时不要重复刷屏。
```

适用：运行中控制全局信息密度。

## 13. 模板 J：门店完整性验收

```text
不要仅根据进程退出或 progress=100% 判断完成。

请对 <STORE_ID>/<RUN_ID> 做离线完整性审计：
1. 计划类目、完成类目、排除类目和缺失类目。
2. raw JSONL 可解析行数和独立类目标记。
3. 门店唯一 SPU、唯一 SKU、嵌套 SKU、类目-商品关系数。
4. 商品名称原文保持情况。
5. 前端展示价、原价、活动价和到手价来源覆盖。
6. checkpoint、summary、artifact 大小和 SHA-256。
7. 多账号结果合并后的重复与缺口。

输出“已证明完整、仍有缺口、需要人工复核”。缺少原始证据时不得宣布完成。
```

适用：门店采集结束前。

## 14. 模板 K：原始数据入库

```text
本次只把采集到的门店原始商品数据入原始快照表，不做业务比价、不裁剪原始字段、不计算推测价格。

来源：<RUN_ID / ARTIFACT_ID>
目标表：<RAW_TABLE_NAME>

入库前请验证：
- 原始 SPU 和所有嵌套 SKU 均可追溯。
- 门店、批次、采集时间和来源标识完整。
- 商品名称保持原文。
- 重复执行幂等。
- 入库行数与离线审计一致。

先 dry-run 并输出预计新增、更新、跳过和异常行；明确批准后才写生产数据库。
```

适用：数据采集闭环后的原始事实入库。

## 15. 模板 L：生成业务 Excel

```text
请从已验收的原始 artifact <ARTIFACT_ID> 生成业务 Excel。
模板：<TEMPLATE_ID>

要求：
- 先保留完整原始数据，导出只是下游投影。
- 商品名称不得改写。
- 按模板 Sheet 和业务字段输出。
- 不向业务文件暴露 runId、账号、Profile、CDP、本机路径、接口和请求码。
- 单独报告优惠券、活动和用户到手价字段是否有原始证据。
- 输出前对账 SPU/SKU 数量和价格覆盖率。
```

适用：向业务同事交付文件。

## 16. 不合格提示词及改法

| 不合格提示 | 风险 | 正确改法 |
|---|---|---|
| “继续” | 不知道继续哪个门店、Slot 和断点 | 指明批次并要求先恢复绑定和 checkpoint |
| “开始采集” | 可能跳过登录、门店和风险预检 | 使用模板 B、C、D |
| “不要停” | 可能在验证码或 403 后继续错误请求 | 改为“风险时暂停受影响 Slot，健康任务继续” |
| “两个号都正常” | 没有页面和门店证据 | 给出 Slot，要求只读确认账号和目标门店 |
| “从上次继续” | 上次断点可能不明确 | 指明 run/checkpoint，要求先对账 raw |
| “把数据入库” | 容易清洗、错表或重复写 | 使用 dry-run、目标表和行数验收 |
| “全部采完了吗” | 容易相信假 100% | 使用完整性审计模板 |
| 在提示词粘贴密码或 Webhook | 凭据进入会话和日志 | 放在包外私密配置，由 ID 引用 |

## 17. 一句话短提示的使用条件

当 Codex 已在本轮明确回复了以下摘要：

```text
批次=<RUN_ID>
门店=<STORE_ID>
Slot=<SLOT_ID>
账号=<ACCOUNT_ALIAS>
Profile=<PROFILE_ID>
断点=<CHECKPOINT_ID>
当前类目=<CATEGORY>
风险=<NONE_OR_EVENT_ID>
```

后续才可以发送：

- “继续当前缺口。”
- “验证已完成，按恢复 Canary 继续。”
- “该账号已登录，先做首屏预检。”
- “保持策略，给我简短进度。”

任何资源发生变化，都要重新发送完整上下文，不能继续依赖旧摘要。

## 18. 可填写任务简报

复制 `config/templates/codex-task-brief.example.md`，在包外工作目录填写。简报不得进入 Git，
不得包含密码、完整手机号、Cookie、Token 或完整动态 URL。

## 19. 模板 M：门店附近定位后再搜索

```text
目标门店：<STORE_ID / STORE_ALIAS>
运营确认的附近位置策略：<LOCATION_POLICY_ID>

请先不要搜索门店或触发商品请求。按顺序检查：
1. 门店策略已配置 locationPreflight 中心点和允许半径。
2. 人工已经在 H5 地址选择器选择目标门店附近位置。
3. 当前 URL 的 actualLat/actualLng 通过距离门禁。
4. 城市和配送地址正确。

位置通过后再搜索或打开目标门店，并以 poi_id_str 做最终校验。位置缺失、超出半径或 POI
不一致时阻断任务并告诉我在哪个 Worker/Slot 重新选择地址。不要使用 CDP 伪造定位。
```
