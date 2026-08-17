import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateOperationsAvailable = await fs.access(
  path.join(repoRoot, "docs", "operations", "66-final-handoff.md")
).then(() => true, () => false);
const private201OperationsAvailable = await fs.access(
  path.join(repoRoot, "docs", "operations", "201-master-current-handoff-20260817.md")
).then(() => true, () => false);

test("handoff runbook covers account risk, profile replacement, login, and recovery", async () => {
  const runbook = await fs.readFile(
    path.join(repoRoot, "docs", "handoff", "14-账号风控Profile与登录操作手册.md"),
    "utf8"
  );
  const requiredConcepts = [
    "403 分类决策",
    "新账号登录 SOP",
    "换号加换 Profile 的完整链路",
    "Profile 生命周期",
    "冷却和复检",
    "设备和网络升级条件",
    "恢复门禁",
    "不迁移 Cookie",
    "不得把已有商品全量重采"
  ];
  for (const concept of requiredConcepts) {
    assert.match(runbook, new RegExp(concept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("new operator acceptance requires risk exercises and supervised canary", async () => {
  const acceptance = await fs.readFile(
    path.join(repoRoot, "docs", "handoff", "15-新人演练与独立操作验收.md"),
    "utf8"
  );
  for (const concept of ["场景 A", "场景 B", "场景 C", "L3 现场 Canary", "L4 独立操作验收"]) {
    assert.match(acceptance, new RegExp(concept));
  }
});

test("risk and lifecycle templates contain no production secret fields", async () => {
  const templates = [
    "risk-event.example.json",
    "account-profile-lifecycle.example.json"
  ];
  for (const name of templates) {
    const content = await fs.readFile(
      path.join(repoRoot, "handoff", "config", "templates", name),
      "utf8"
    );
    assert.doesNotMatch(content, /password|smsCode|authorization|cookie|webhook/i);
    assert.doesNotMatch(content, /(?:^|[^*])1[3-9]\d{9}(?:$|[^\d])/);
    assert.doesNotThrow(() => JSON.parse(content));
  }
});

test("Codex prompt handbook covers the full collection conversation lifecycle", async () => {
  const handbook = await fs.readFile(
    path.join(repoRoot, "docs", "handoff", "16-Codex提示词手册与模板.md"),
    "utf8"
  );
  const requiredPrompts = [
    "新人第一次接手",
    "新批次开始前只读检查",
    "账号已经人工登录",
    "开始全量采集",
    "Codex 中断后恢复",
    "人工已完成验证码",
    "出现 403",
    "更换账号和 Profile",
    "门店完整性验收",
    "原始数据入库",
    "不合格提示词及改法"
  ];
  for (const prompt of requiredPrompts) {
    assert.match(handbook, new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("Codex task brief uses placeholders instead of production identities", async () => {
  const brief = await fs.readFile(
    path.join(repoRoot, "handoff", "config", "templates", "codex-task-brief.example.md"),
    "utf8"
  );
  assert.match(brief, /<RUN_ID>/);
  assert.match(brief, /<ACCOUNT_ALIAS>/);
  assert.match(brief, /<CHECKPOINT_ID>/);
  assert.doesNotMatch(brief, /(?:^|[^*])1[3-9]\d{9}(?:$|[^\d])/);
  assert.doesNotMatch(brief, /access_token=|password\s*[:=]|Cookie:/i);
});

test("opening prompt drives a newcomer from package verification to complete store delivery", async () => {
  const openingPrompt = await fs.readFile(
    path.join(repoRoot, "START_WITH_THIS_PROMPT.md"),
    "utf8"
  );
  const stages = [
    "阶段 0：恢复项目真相",
    "阶段 1：现场环境和资源发现",
    "阶段 2：设计一个门店的账号和类目计划",
    "阶段 3：创建 CDP/Profile 并等待人工登录",
    "阶段 4：低频只读预检和 Canary",
    "阶段 5：全门店低频采集",
    "阶段 6：风险、验证和换号恢复",
    "阶段 7：进度和通知",
    "阶段 8：全量完整性审计",
    "阶段 9：交付"
  ];
  for (const stage of stages) {
    assert.match(openingPrompt, new RegExp(stage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const boundary of [
    "不绕过验证码",
    "不重复采集已落盘商品",
    "不能从零重采",
    "不使用子智能体",
    "只有所有有效类目 completed_valid"
  ]) {
    assert.match(openingPrompt, new RegExp(boundary));
  }
});

test("handoff requires a persistent identity page, account-change reminder and store-area preflight", async () => {
  const openingPrompt = await fs.readFile(path.join(repoRoot, "START_WITH_THIS_PROMPT.md"), "utf8");
  const bindingRunbook = await fs.readFile(
    path.join(repoRoot, "docs", "handoff", "04-设备账号Profile-CDP门店绑定.md"),
    "utf8"
  );
  const riskRunbook = await fs.readFile(
    path.join(repoRoot, "docs", "handoff", "14-账号风控Profile与登录操作手册.md"),
    "utf8"
  );
  for (const phrase of [
    "完整登录手机号",
    "账号所属人",
    "保存标识",
    "包外私密账号映射",
    "Codex 必须在当前直接任务中明确提醒",
    "单个全量门店默认按约 5 个授权账号",
    "只打开常驻标识页和美团登录页",
    "登录成功后才打开目标门店",
    "账号更换时必须先修改并保存标识页",
    "locationPreflight",
    "actualLat/actualLng",
    "位置通过前不得搜索目标门店"
  ]) {
    assert.match(`${openingPrompt}\n${bindingRunbook}\n${riskRunbook}`, new RegExp(phrase));
  }
});

test("private account contact map is placeholder-only", async () => {
  const contactMap = await fs.readFile(
    path.join(repoRoot, "handoff", "config", "templates", "account-contact-map.example.json"),
    "utf8"
  );
  assert.match(contactMap, /<FULL_LOGIN_PHONE>/);
  assert.match(contactMap, /<OPERATOR_OWNER>/);
  assert.doesNotMatch(contactMap, /(?:^|[^*])1[3-9]\d{9}(?:$|[^\d])/);
  assert.doesNotThrow(() => JSON.parse(contactMap));
});

test("66 standalone handoff includes final facts, decision index, and sanitized prompt history", {
  skip: privateOperationsAvailable ? false : "private operations documents are intentionally absent"
}, async () => {
  const finalHandoff = await fs.readFile(
    path.join(repoRoot, "docs", "operations", "66-final-handoff.md"),
    "utf8"
  );
  const decisionIndex = await fs.readFile(
    path.join(repoRoot, "docs", "operations", "66-requirement-decision-index.md"),
    "utf8"
  );
  const promptArchive = await fs.readFile(
    path.join(repoRoot, "docs", "operations", "66-current-thread-original-user-prompts-sanitized.md"),
    "utf8"
  );
  const startupPrompt = await fs.readFile(
    path.join(repoRoot, "docs", "operations", "66-codex-startup-prompt.md"),
    "utf8"
  );

  for (const concept of ["基础设施交接已经完成", "真实采集尚未开始", "未做整机重启后的自动恢复演练"]) {
    assert.match(finalHandoff, new RegExp(concept));
  }
  for (const concept of ["P377-P385", "历史提问是需求演变证据", "不构成采集"]) {
    assert.match(`${decisionIndex}\n${startupPrompt}`, new RegExp(concept));
  }
  assert.match(promptArchive, /P385/);
  assert.match(promptArchive, /手机号已脱敏/);
  assert.doesNotMatch(promptArchive, /(?:^|[^*])1[3-9]\d{9}(?:$|[^\d])/m);
  assert.doesNotMatch(promptArchive, /access_token=[A-Za-z0-9_-]{16,}/i);
});

test("66 single-store execution handoff preserves collection truth and safe recovery boundaries", {
  skip: privateOperationsAvailable ? false : "private operations documents are intentionally absent"
}, async () => {
  const executionHandoff = await fs.readFile(
    path.join(repoRoot, "docs", "operations", "66-xcgjz-single-store-execution-handoff.md"),
    "utf8"
  );
  const completePrompt = await fs.readFile(
    path.join(repoRoot, "docs", "operations", "66-xcgjz-codex-complete-prompt.md"),
    "utf8"
  );
  const publicManifest = JSON.parse(await fs.readFile(
    path.join(repoRoot, "scripts", "publication", "public-files.json"),
    "utf8"
  ));

  for (const concept of [
    "meituan_h5:gN8C492bwzzgoOEEPtVobwI",
    "最少的有效请求获得最多的完整数据",
    "类目商品关系不去重",
    "原子接管",
    "租约代际",
    "checkpoint",
    "403",
    "隔离",
    "不得把轮换账号、Profile 或网络当作绕过访问限制的手段",
    "LangGraph 不进入核心采集主链路",
    "公开仓库不包含 66 私有运维事实",
    "单门店默认准备约 5 个授权账号",
    "每个席位只打开“CDP 标识页 + 美团登录页”",
    "中途换号必须先暂停该席位并保存 checkpoint",
    "原始 JSONL"
  ]) {
    assert.match(executionHandoff, new RegExp(concept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const concept of [
    "第一阶段：理解",
    "第二阶段：开始执行",
    "D:\\SpanAI\\retail-price-orchestrator",
    "每个 CDP 初始只打开标识页和美团登录页",
    "中途更换账号时，必须先暂停并保存 checkpoint",
    "未满足门禁时不得创建真实采集任务",
    "先输出理解摘要"
  ]) {
    assert.match(completePrompt, new RegExp(concept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.ok(publicManifest.excludedPrefixes.includes("docs/operations/"));
});

test("201 master handoff separates source from runtime and preserves production gates", {
  skip: private201OperationsAvailable ? false : "private 201 operations documents are intentionally absent"
}, async () => {
  const currentHandoff = await fs.readFile(
    path.join(repoRoot, "docs", "operations", "201-master-current-handoff-20260817.md"),
    "utf8"
  );
  const completePrompt = await fs.readFile(
    path.join(repoRoot, "docs", "operations", "201-master-codex-complete-prompt.md"),
    "utf8"
  );
  const startupPrompt = await fs.readFile(
    path.join(repoRoot, "docs", "operations", "201-codex-startup-prompt.md"),
    "utf8"
  );
  const all = `${currentHandoff}\n${completePrompt}\n${startupPrompt}`;

  for (const concept of [
    "D:\\SpanAI\\retail-price-orchestrator",
    "D:\\SpanAI\\retail-radar-master\\app",
    "只负责呱呱超市（昆明路店）和犀牛百货（科技路店）",
    "小柴购超市（甘家寨店）属于 66 独立节点",
    "每个门店默认准备约 5 个授权账号",
    "常驻标识页 + 美团登录页",
    "登录成功后才打开目标门店",
    "先修改并保存标识页",
    "DWS 实时读取",
    "第一阶段：理解",
    "第二阶段：只读接管",
    "当前不授权真实采集"
  ]) {
    assert.match(all, new RegExp(concept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.doesNotMatch(all, /access_token=[A-Za-z0-9_-]{16,}/i);
  assert.doesNotMatch(all, /(?:^|[^*])1[3-9]\d{9}(?:$|[^\d])/m);
});
