# 商圈比价可执行交接发布包设计

更新日期：2026-07-31

## 1. 决策

采用“可执行交接发布包”方案。

交接物不是当前工作区的整体压缩包，也不是只描述架构的文档包，而是一份能够让新同事和新 Codex 按固定顺序完成理解、离线演练、环境检查、Worker 接入和真实小类目 Canary 的独立发布物。

发布包必须同时满足：

1. 新 Codex 只有一个入口，不需要从历史会话猜测当前主链路。
2. 已验证采集脚本原样复用，除可移植配置和交接工具外不重写采集核心。
3. 账号、Profile、CDP、门店、类目、断点、风险和数据产物的关系有明确数据契约。
4. 少量脱敏真实样例可离线演练计划、采集进度、断点、原始数据、质量检查和导出。
5. 发布包不包含登录状态、浏览器 Profile、真实凭据、完整手机号和生产原始数据。
6. 自动验收能证明包内文件完整、无敏感信息、命令可执行、样例可回放。

## 2. 第一性原理

交接失败的根因通常不是缺少代码，而是接手者无法判断：

- 哪个脚本是当前主链路。
- 哪些文档仍然有效。
- 哪些数据属于原始事实，哪些只是业务投影。
- 哪个账号、Profile、CDP 和门店应当绑定。
- 任务为什么停止，应该等待、人工处理还是迁移资源。
- “脚本跑完”是否真的等于“门店数据完整”。

因此交接包的核心产品不是 ZIP 文件，而是一个可验证的认知和执行协议：

```text
唯一入口
  -> 当前事实与边界
  -> 环境诊断
  -> 脱敏样例回放
  -> Worker/CDP 现场检查
  -> 小类目 Canary
  -> 正式批次
  -> 原始数据质量门
  -> 导出/入库
```

## 3. 当前资产审计结论

### 3.1 当前生产主体

`retail-price-orchestrator` 是交接主体，包含：

- Master API、调度、租约、风险、产物和数据质量服务。
- Worker Agent、Browser Slot、CDP 启停、采集执行和本地 spool。
- React 操作台。
- PostgreSQL、Redis、MinIO、Caddy 和部署脚本。
- `scripts/native-cdp-store-capture.mjs` 当前原生采集主链路。
- 生产自检、E2E、发布包和 Worker 安装脚本。

### 3.2 历史实验资产

以下目录和根目录脚本包含早期探索价值，但不能作为新 Codex 的运行入口：

- `_tmp_single_account_store_capture_20260707`
- `_tmp_three_store_nine_account_capture_20260708`
- 工作区根目录的 `mt-cdp-*`、receiver、observer、probe 和 normalize 脚本
- 历史截图、日志、过程 JSONL 和旧导出文件

其中有效经验要提炼到故障手册和决策记录；历史脚本不原样混入生产入口。

### 3.3 必须排除的资产

- 所有 Chrome/Edge Profile、Cookie、Local Storage 和浏览器缓存。
- `.env`、Webhook、数据库密码、SSH 密码、Worker Token 和签名私钥。
- `.runtime`、Worker 本地 spool、当前 checkpoint 和生产日志。
- 未脱敏真实 JSONL、截图、Excel、数据库备份。
- `node_modules`、`dist`、Docker 数据卷、缓存和 `.git`。
- 完整手机号、账号实名、本机绝对路径和动态请求标识。

## 4. 交接发布包结构

最终目录：

```text
retail-price-orchestrator-handoff-20260731/
├── HANDOFF_START_HERE.md
├── AGENTS.md
├── README.md
├── VERSION
├── MANIFEST.json
├── SHA256SUMS.txt
├── project/
│   └── 当前源码快照
├── docs/
│   └── handoff/
│       ├── 00-项目目标与边界.md
│       ├── 01-系统架构与数据流.md
│       ├── 02-Codex固定阅读与操作顺序.md
│       ├── 03-环境安装与诊断.md
│       ├── 04-设备账号Profile-CDP门店绑定.md
│       ├── 05-任务规划与低频采集SOP.md
│       ├── 06-断点恢复与跨Worker迁移.md
│       ├── 07-风险事件与人工处理.md
│       ├── 08-原始数据质量与完整性验收.md
│       ├── 09-Excel导出与数据库入库.md
│       ├── 10-部署升级回滚与备份.md
│       ├── 11-故障案例和禁止重踩事项.md
│       ├── 12-已验证与待现场验证能力.md
│       └── 13-资产来源与替代关系.md
├── config/
│   └── templates/
│       ├── master.env.example
│       ├── worker.env.example
│       ├── browser-slots.example.json
│       ├── stores.example.json
│       └── notification.example.json
├── examples/
│   └── deidentified/
│       ├── README.md
│       ├── capture.plan.json
│       ├── capture.progress.jsonl
│       ├── capture.checkpoint.json
│       ├── capture.products.raw.jsonl
│       ├── capture.summary.json
│       ├── risk-events.jsonl
│       └── expected-audit.json
├── scripts/
│   └── handoff/
│       ├── doctor.mjs
│       ├── verify-package.mjs
│       ├── verify-redaction.mjs
│       ├── replay-sample.mjs
│       ├── verify-doc-links.mjs
│       └── build-package.ps1
└── reports/
    ├── package-verification.json
    └── source-provenance.json
```

## 5. 唯一入口协议

### 5.1 `HANDOFF_START_HERE.md`

新同事或新 Codex 必须首先读取该文件。内容只回答：

- 系统为什么存在。
- 当前主链路是什么。
- 哪些动作禁止执行。
- 应按什么顺序阅读和验证。
- 第一次真实采集前必须满足哪些门禁。
- 遇到验证码、403、418、登录失效和门店不匹配时如何停在安全状态。

入口文件不得包含过期设备 IP、真实手机号、固定 CDP 端口或生产凭据。

### 5.2 `AGENTS.md`

对 Codex 设置强制规则：

- 默认只读诊断，未经明确指令不启动真实采集。
- 不绕过验证码、身份核验和平台限制。
- 不使用风险 Profile 登录新账号。
- 不把 CDP 端口当成账号身份。
- 不在未确认门店 ID 前发出商品请求。
- 不从零重采已有有效断点。
- 不把进度日志的 `100%` 当作数据完整证明。
- 不删除 Profile、checkpoint、原始数据和历史产物。
- 不把密钥写入源码或交接文档。
- 不直接将结构化投影当作原始数据。
- 生产写入必须经过预览、质量门和显式确认。

## 6. 文档真相层级

文档按以下优先级解释：

1. `HANDOFF_START_HERE.md`
2. `docs/handoff/` 当前交接文档
3. 当前源码、测试和命令输出
4. `project/docs/` 历史设计与验证报告
5. 历史实验目录和旧会话

如果文档与当前代码冲突，以当前代码、测试和现场事实为准，并登记差异，不允许静默选择旧文档。

历史文档必须在资产索引中标注：

- `current`：当前有效。
- `reference`：部分内容可参考。
- `superseded`：已被新设计替代。
- `evidence`：只证明特定日期和环境。

## 7. 脱敏真实样例

### 7.1 目标

样例用于离线证明：

- 类目计划可解析。
- progress 和 checkpoint 可恢复。
- 原始商品和嵌套 SKU 可审计。
- 风险事件可以阻断任务。
- 展示价来源和数据质量可以检查。
- Excel 或业务投影可以由原始数据重建。

样例不证明生产门店当前完整，也不能用于生产入库。

### 7.2 样例内容

样例应覆盖：

- 两个常规类目。
- 一个营销/聚合类目。
- 一个多 SKU 商品。
- 一个前端活动价商品。
- 一个缺少可选字段但仍有效的商品。
- 一个重复观察，用于验证幂等去重。
- 一个 403/418 或验证码风险事件。
- 一个已完成 checkpoint 和一个未完成 checkpoint。

### 7.3 脱敏规则

所有标识使用稳定假值：

- Worker：`sample-worker-01`
- Slot：`sample-slot-01`
- Account：`sample-account-01`
- Profile：`sample-profile-01`
- Store：`sample-store-01`
- CDP：`19221`

必须删除或替换：

- 完整手机号、姓名和账号归属人。
- Cookie、Token、UUID、访问签名和请求流水号。
- Profile 绝对路径、用户名和主机路径。
- 真实门店 URL 动态参数和经纬度。
- 图片 URL 中可能携带的查询参数。
- 钉钉 Webhook 和数据库连接信息。

商品名称、规格、价格和原始字段结构可以保留，但样例文档必须声明其已脱敏且不代表当前市场价格。

## 8. 源码快照策略

发布包的 `project/` 来自当前工作树，而不是只使用最后一次 Git 提交，因为当前存在尚未提交的生产增强代码。

收集规则：

- 包含 Git 已跟踪文件。
- 包含未跟踪但未被 `.gitignore` 排除的源码、测试、文档和部署文件。
- 排除所有忽略项、`.git`、构建缓存和本地运行资产。
- 不改变原工作树，不移动、不删除任何现有文件。
- 生成来源清单，记录源文件相对路径、大小和 SHA-256。

发布包是当前工作树的只读快照，不隐含“已提交到远端”或“已部署到生产”。

## 9. 配置模型

### 9.1 原则

- 代码中没有真实密钥。
- 环境相关值集中在模板和本地 `.env`。
- 账号、Profile、CDP、门店关系使用独立配置或 Master 数据模型。
- 端口、IP、手机号和设备名称不写死在脚本里。
- 新 Worker 通过接入流程登记，不复制其他 Worker identity。

### 9.2 配置验证

`doctor.mjs` 检查：

- Node.js、pnpm、Chrome 和 Docker 可用性。
- 操作系统和架构。
- 必需环境变量是否存在，但不打印值。
- Master、PostgreSQL、Redis 和 MinIO 的可达性选项。
- Worker identity、输出目录、磁盘和系统时间。
- CDP endpoint 格式及端口冲突。
- Profile 路径是否位于允许目录。

诊断默认不连接真实 CDP、不启动 Chrome、不发采集请求。

## 10. 新 Codex 上手流程

### 10.1 离线阶段

1. 读取唯一入口和 `AGENTS.md`。
2. 运行发布包完整性校验。
3. 运行敏感信息扫描。
4. 运行脱敏样例回放。
5. 读取已验证/待验证矩阵。
6. 输出当前理解、风险和现场需要的信息。

### 10.2 现场只读阶段

1. 运行环境诊断。
2. 读取 Master/Worker 健康状态。
3. 识别 Browser Slot、账号、Profile、CDP 和门店绑定。
4. 检查页面标题、门店 ID 和风险状态。
5. 核对 checkpoint 和已有原始产物。
6. 不发商品请求。

### 10.3 Canary 阶段

1. 选择一个健康账号、纯采集 Profile 和一个小类目。
2. 显式确认门店。
3. 使用生产低频参数执行。
4. 验证原始 JSONL、checkpoint、summary、风险上报和质量结果。
5. 通过后才扩大类目和账号数量。

## 11. 风险闭环

### 11.1 风险分类

| 症状 | 系统动作 | 人工动作 | 恢复条件 |
|---|---|---|---|
| 验证码/身份核验 | 停止该 Slot 请求、保存断点、通知 | 完成页面验证 | 页面和门店复检通过 |
| 403/418 | 停止重试、进入冷却 | 检查账号和页面 | 明确健康后恢复 |
| 登录失效 | 暂停任务 | 重新登录 | 账号标识与门店一致 |
| 门店商品不可见 | 账号/Profile 风险 | 更换账号和新 Profile | 新资源预检通过 |
| 多账号同设备异常 | Worker 风险 | 检查网络/IP/设备 | Canary 通过 |
| Worker 离线 | 租约停止推进 | 恢复设备 | 心跳、spool 和断点对账 |
| 错门店 | 请求前阻断 | 打开正确门店 | `poi_id_str` 一致 |

### 11.2 禁止动作

- 验证页面持续轮询。
- 403/418 后快速切号重试同一请求。
- 风险 Profile 绑定新账号。
- 从深页断点直接对新账号发请求。
- 未迁移 checkpoint 就跨 Worker 重采。
- 把 IP 池或指纹伪装作为默认解决方案。

## 12. 数据事实与质量门

### 12.1 事实层

原始 JSONL 和其对象存储版本是可重建事实。PostgreSQL SPU/SKU、RetailMart 表和 Excel 都是投影。

必须保留：

- 采集时间。
- 门店、批次、任务和类目标识。
- SPU 原始对象。
- `productRaw.skus[]` 完整嵌套 SKU。
- 展示价及其原始来源路径。
- checkpoint、summary 和风险事件。

### 12.2 完整性

禁止使用单一百分比宣告完整。至少核对：

- 计划类目数与有效独立类目标记。
- 每类目期望 SPU、原始 SPU 和缺失 ID。
- 原始嵌套 SKU 并集与结构化 SKU。
- 商品名称原样保持。
- 前端展示价覆盖率。
- 原始文件大小、SHA-256 和对象版本。
- 重复任务和重复执行行。

营销类目可能与普通类目重叠，必须分别报告“门店唯一商品”和“类目-商品关系”。

## 13. 自动验收工具

### 13.1 `verify-package.mjs`

检查：

- 必需文件存在。
- Manifest 与实际文件一致。
- SHA-256 一致。
- 排除目录和文件未进入发布包。
- 文件名和路径可在 Windows/macOS 解压。

### 13.2 `verify-redaction.mjs`

扫描：

- 11 位手机号。
- Webhook access token。
- Cookie、Authorization 和 Bearer。
- 数据库、Redis、MinIO、SSH 密码模式。
- Windows 用户目录和 macOS 用户目录。
- Chrome Profile 数据库和缓存特征。
- 真实 `.env` 和私钥。

扫描结果必须为零；模板占位符使用明确的 `<...>` 或空值。

### 13.3 `replay-sample.mjs`

离线完成：

- JSONL 解析。
- checkpoint 恢复。
- SPU/SKU 去重。
- 展示价覆盖统计。
- 风险事件状态验证。
- 与 `expected-audit.json` 对账。

### 13.4 `verify-doc-links.mjs`

检查交接文档中所有相对路径、命令引用和入口链接存在。

## 14. 验证层级

发布报告区分：

| 层级 | 含义 |
|---|---|
| L0 静态完整 | 文件、Manifest、SHA-256、脱敏和文档链接通过 |
| L1 离线可执行 | 样例回放、单元测试、类型检查和构建通过 |
| L2 本机集成 | Docker 依赖、Master、Worker 和 Dashboard E2E 通过 |
| L3 现场 Canary | 新设备、真实 CDP、真实门店小类目通过 |
| L4 正式批次 | 门店全量、质量门、导出和入库对账通过 |

交接发布包完成的最低门槛为 L1；若本机条件允许则完成 L2。L3/L4 必须由接手环境现场验证，不能由历史报告代替。

## 15. 发布产物

生成：

```text
handoff/releases/retail-price-orchestrator-handoff-20260731/
handoff/releases/retail-price-orchestrator-handoff-20260731.zip
handoff/releases/retail-price-orchestrator-handoff-20260731.zip.sha256
```

同时保留构建报告：

- 源文件数量与总大小。
- 排除项统计。
- 脱敏扫描结果。
- 样例回放结果。
- 测试、类型检查和构建结果。
- ZIP SHA-256。
- 未完成的现场验证事项。

## 16. 对抗式审查

### 16.1 新 Codex 读错旧文档

防护：唯一入口、文档真相层级和资产状态索引。

### 16.2 把历史验证当成当前生产事实

防护：验证分层；历史报告只标为特定日期证据，现场能力必须重新验证。

### 16.3 包含真实账号会话

防护：Profile/runtime 硬排除、敏感扫描、Manifest 白名单和 ZIP 二次扫描。

### 16.4 复制了源码但遗漏未提交文件

防护：从当前工作树收集“tracked + untracked non-ignored”，不使用单纯 `git archive`。

### 16.5 样例被误入生产

防护：样例使用 `sample-*` 身份和不可用门店地址；生产脚本拒绝 sample 标识。

### 16.6 新环境路径不同

防护：源码使用相对路径和环境变量；扫描本机绝对路径；Windows/macOS 分别提供命令。

### 16.7 脚本运行完成但数据不完整

防护：门店唯一商品、类目关系、原始 SKU、结构化 SKU、价格覆盖和 artifact 哈希联合质量门。

### 16.8 交接包生成后无法复现

防护：在新的临时目录解压 ZIP，重新运行完整性、脱敏、文档和样例回放检查。

## 17. 非目标

- 不在交接工作中重写采集算法。
- 不自动执行真实门店采集。
- 不删除或归档现有实验目录、Profile、原始数据和历史导出。
- 不把所有历史会话逐字放入交接包。
- 不承诺接手环境无需登录、验证码或现场配置。
- 不把交接包发布到公开仓库。

## 18. 完成标准

设计实施完成必须同时满足：

1. 唯一入口、Codex 约束和 14 份交接文档齐全。
2. 当前源码快照无 runtime/Profile/凭据。
3. 脱敏样例覆盖正常、断点和风险路径。
4. 自动验收与样例回放通过。
5. 当前代码测试、类型检查和构建结果被如实记录。
6. ZIP 在新目录解压后复验通过。
7. 发布包、ZIP、SHA-256 和验证报告均生成。
8. 所有未完成现场验证明确列出。

