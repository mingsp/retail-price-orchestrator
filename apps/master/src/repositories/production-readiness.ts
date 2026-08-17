import type {
  CategoryTaskRecord,
  ProductionReadinessIssue,
  ProductionReadinessReport,
  RiskEventRecord,
  StoreRecord,
  StoreRunRecord,
  WorkerStatusRow
} from "@retail-orchestrator/shared";
import type { AccountPoolRecord } from "@retail-orchestrator/shared";

export interface ReadinessOptions {
  expectedWorkerIds?: string[];
  expectedAccountCount?: number;
  expectedCdpCount?: number;
  minimumWorkerVersion?: string;
}

export interface ReadinessInput {
  workers: WorkerStatusRow[];
  stores: StoreRecord[];
  runs: StoreRunRecord[];
  tasks: CategoryTaskRecord[];
  risks: RiskEventRecord[];
  accountPool?: AccountPoolRecord[];
  invalidArtifactCount?: number;
  notificationDeadLetterCount?: number;
  options?: ReadinessOptions;
  workerSharedTokenIsDefault?: boolean;
  dingtalkNotificationConfigured?: boolean;
  monitoringAlertConfigured?: boolean;
  now?: Date;
}

const MIN_WORKER_DISK_FREE_BYTES = 5 * 1024 ** 3;
const MAX_WORKER_CLOCK_OFFSET_MS = 30_000;
const DEFAULT_MINIMUM_WORKER_VERSION = "0.1.0";

export function buildProductionReadinessReport(input: ReadinessInput): ProductionReadinessReport {
  const now = input.now || new Date();
  const issues: ProductionReadinessIssue[] = [];
  const workers = input.workers;
  const workerById = new Map(workers.map((row) => [row.worker.workerId, row]));
  const accounts = workers.flatMap((row) => row.accounts.map((account) => ({ ...account, workerId: row.worker.workerId })));
  const endpoints = workers.flatMap((row) => (row.cdpEndpoints || []).map((endpoint) => ({ ...endpoint, workerId: endpoint.workerId || row.worker.workerId })));
  const profiles = accounts.map((account) => ({
    profileId: account.profileId,
    profileStatus: account.profileStatus,
    accountId: account.accountId,
    workerId: account.workerId
  }));
  const openRisks = input.risks.filter((risk) => risk.status !== "resolved");
  const activeRuns = input.runs.filter((run) => ["planned", "running", "paused"].includes(run.status));
  const accountPoolById = new Map((input.accountPool || []).map((account) => [account.accountId, account]));

  if (!workers.length) {
    issues.push(issue("system:no-workers", "blocker", "system", "没有在线或已登记 Worker", "master 没有任何 worker 记录，无法进入生产采集。", "先启动 mm-worker 和 jl-worker，并确认心跳进入 dashboard。"));
  }

  if (input.workerSharedTokenIsDefault) {
    issues.push(issue("system:default-worker-token", "blocker", "system", "Worker 共享密钥仍是默认值", "当前 WORKER_SHARED_TOKEN 仍为 change-me，worker 写接口不会启用生产鉴权。", "设置一个随机强 token，并用同一个 token 重启 master 和所有 worker。"));
  }

  if (input.dingtalkNotificationConfigured === false) {
    issues.push(issue(
      "system:dingtalk-notification-missing",
      "blocker",
      "system",
      "人工处理通知尚未配置",
      "验证码、403、418 或设备中断发生时，系统无法通知对应处理人。",
      "请在 Master 受限配置中录入正式钉钉机器人 Webhook，并完成一次受控通知演练。"
    ));
  }

  if (input.monitoringAlertConfigured === false) {
    issues.push(issue(
      "system:monitoring-alert-missing",
      "blocker",
      "system",
      "系统监控告警尚未配置",
      "设备离线、任务卡住或数据产物异常时，系统无法形成持续监测和恢复通知。",
      "启用 Prometheus 与 Alertmanager，配置内部告警令牌，并完成一次触发与恢复演练。"
    ));
  }

  if ((input.invalidArtifactCount || 0) > 0) {
    issues.push(issue("data:artifact-evidence-invalid", "blocker", "system", "存在不可核验的原始数据产物", `发现 ${input.invalidArtifactCount} 个原始产物缺少校验和或对象版本。`, "先补齐或重新上传原始产物证据，再继续交付。"));
  }
  if ((input.notificationDeadLetterCount || 0) > 0) {
    issues.push(issue("system:notification-dead-letter", "blocker", "system", "存在未送达的人工处理通知", `有 ${input.notificationDeadLetterCount} 条通知进入人工复核队列。`, "先核对通知结果并处理对应风险，再开始新批次。"));
  }

  for (const expectedWorkerId of input.options?.expectedWorkerIds || []) {
    const row = workerById.get(expectedWorkerId);
    if (!row) {
      issues.push(issue(`worker:missing:${expectedWorkerId}`, "blocker", "worker", `缺少预期 Worker：${expectedWorkerId}`, "本次生产计划要求该 worker 在线，但系统未登记到它。", "启动对应 worker，或从本次计划中移除该 worker。", [expectedWorkerId]));
    } else if (row.worker.status !== "online") {
      issues.push(issue(`worker:offline:${expectedWorkerId}`, "blocker", "worker", `Worker 不在线：${expectedWorkerId}`, `当前状态为 ${row.worker.status}。`, "恢复该设备的 worker 进程和网络后再开采。", [expectedWorkerId]));
    }
  }

  for (const row of workers) {
    if (isPlaceholder(row.worker.workerId) || isPlaceholder(row.worker.machineLabel)) {
      issues.push(issue(`worker:placeholder:${row.worker.workerId}`, "blocker", "worker", `Worker 命名疑似测试项：${row.worker.workerId}`, "生产系统中不应出现 test/debug/demo 等标识。", "停止该 worker，删除残留登记，只保留本次生产设备。", [row.worker.workerId]));
    }
    const minimumWorkerVersion = input.options?.minimumWorkerVersion || DEFAULT_MINIMUM_WORKER_VERSION;
    if (compareVersions(row.worker.agentVersion, minimumWorkerVersion) < 0) {
      issues.push(issue(
        `worker:version:${row.worker.workerId}`,
        "blocker",
        "worker",
        `设备版本需要升级：${row.worker.machineLabel}`,
        `当前版本 ${row.worker.agentVersion}，生产最低要求 ${minimumWorkerVersion}。`,
        "先将 Worker 升级到兼容版本并确认心跳恢复。",
        [row.worker.workerId]
      ));
    }
    if (row.worker.status === "device_risk") {
      issues.push(issue(`worker:device-risk:${row.worker.workerId}`, "blocker", "worker", `设备被标记为风险：${row.worker.machineLabel}`, "该设备不应继续分配采集任务。", "暂停该设备，确认网络、账号、Profile 后再恢复。", [row.worker.workerId]));
    } else if (row.worker.status !== "online") {
      issues.push(issue(`worker:not-online:${row.worker.workerId}`, "warning", "worker", `Worker 状态非在线：${row.worker.machineLabel}`, `当前状态为 ${row.worker.status}。`, "确认是否仍属于本次生产计划，非本次计划应清理。", [row.worker.workerId]));
    }
    if (
      row.worker.remoteDesktop?.status !== "ready" ||
      row.worker.remoteDesktop.provider === "none" ||
      !row.worker.remoteDesktop.target
    ) {
      issues.push(issue(
        `worker:remote-desktop:${row.worker.workerId}`,
        "blocker",
        "worker",
        `设备无法远程处理：${row.worker.machineLabel}`,
        "该设备遇到登录或人工验证时，操作台无法定位并打开对应设备。",
        "配置局域网远程桌面入口并在 Worker 心跳中确认可用。",
        [row.worker.workerId]
      ));
    }
    if (row.worker.diskFreeBytes === undefined || row.worker.diskFreeBytes < MIN_WORKER_DISK_FREE_BYTES) {
      issues.push(issue(
        `worker:disk:${row.worker.workerId}`,
        "blocker",
        "worker",
        `设备可用空间不足：${row.worker.machineLabel}`,
        "原始数据和断点文件可能无法可靠落盘。",
        "释放空间并确保至少保留 5 GB 可用容量。",
        [row.worker.workerId]
      ));
    }
    if (row.worker.clockOffsetMs === undefined || Math.abs(row.worker.clockOffsetMs) >= MAX_WORKER_CLOCK_OFFSET_MS) {
      issues.push(issue(
        `worker:clock:${row.worker.workerId}`,
        "blocker",
        "worker",
        `设备时间不同步：${row.worker.machineLabel}`,
        "设备时间偏差会影响租约、采集时间和故障审计。",
        "同步系统时间，确保与 Master 的偏差小于 30 秒。",
        [row.worker.workerId]
      ));
    }
    if ((row.execution?.outbox?.deadLetter || 0) > 0) {
      issues.push(issue(
        `worker:outbox-dead-letter:${row.worker.workerId}`,
        "blocker",
        "worker",
        `设备存在未回传的数据事件：${row.worker.machineLabel}`,
        `有 ${row.execution?.outbox?.deadLetter} 条事件已停止自动重试。`,
        "先在设备上核对本地 Outbox 死信并完成恢复或人工确认。",
        [row.worker.workerId]
      ));
    }
  }

  if (input.options?.expectedAccountCount !== undefined && accounts.length !== input.options.expectedAccountCount) {
    issues.push(issue("account:count-mismatch", "blocker", "account", "账号数量与本次计划不一致", `当前登记 ${accounts.length} 个账号，计划需要 ${input.options.expectedAccountCount} 个。`, "补齐账号/CDP，或修正本次生产计划参数。"));
  }
  if (input.options?.expectedCdpCount !== undefined && endpoints.length !== input.options.expectedCdpCount) {
    issues.push(issue("cdp:count-mismatch", "blocker", "cdp", "CDP 数量与本次计划不一致", `当前登记 ${endpoints.length} 个 CDP，计划需要 ${input.options.expectedCdpCount} 个。`, "补齐 CDP/Profile，或清理残留后重新检查。"));
  }

  for (const account of accounts) {
    if (input.accountPool && !accountPoolById.has(account.accountId)) {
      issues.push(issue(`account:pool-missing:${account.accountId}`, "blocker", "account", `账号未登记到生产账号池：${account.displayName}`, "运行态账号没有冷却时间、风险状态和归属记录，不能安全调度。", "先同步账号池并确认账号状态，再允许领取任务。", [account.workerId, account.accountId]));
    }
    if (isPlaceholder(account.accountId) || isPlaceholder(account.displayName)) {
      issues.push(issue(`account:placeholder:${account.accountId}`, "blocker", "account", `账号标识疑似测试项：${account.displayName}`, "账号标识用于风险定位，不能是 test/demo/default。", "在 CDP 标识页维护真实账号槽位和归属人。", [account.workerId, account.accountId]));
    }
    if (!account.maskedLogin || isPlaceholder(account.maskedLogin)) {
      issues.push(issue(`account:missing-login:${account.accountId}`, "blocker", "account", `账号缺少手机号标识：${account.displayName}`, "遇到验证码或封控时无法定位责任账号。", "登录前在 CDP 标识页填写脱敏手机号。", [account.workerId, account.accountId]));
    }
    if (!["safe", "running"].includes(account.status) || ["high", "blocked"].includes(account.riskLevel)) {
      issues.push(issue(`account:risk:${account.accountId}`, "blocker", "account", `账号不可调度：${account.displayName}`, `账号状态 ${account.status}，风险等级 ${account.riskLevel}。`, "换号或先解除人工阻断，不要让该账号领取任务。", [account.workerId, account.accountId]));
    } else if (account.riskLevel === "watch") {
      issues.push(issue(`account:watch:${account.accountId}`, "warning", "account", `账号处于观察态：${account.displayName}`, "该账号可用但需要降低任务密度并重点观察。", "确认是否纳入本轮采集，必要时改用备用账号。", [account.workerId, account.accountId]));
    }
    if (account.profileStatus !== "safe") {
      issues.push(issue(`profile:risk:${account.profileId}`, "blocker", "profile", `Profile 不安全：${account.profileId}`, `Profile 状态为 ${account.profileStatus}。`, "新建干净 Profile 并重新登录，不要复用风险 Profile。", [account.workerId, account.accountId, account.profileId]));
    }
  }

  for (const endpoint of endpoints) {
    if (!["ready", "idle", "running"].includes(endpoint.status)) {
      issues.push(issue(`cdp:not-ready:${endpoint.endpointId}`, "blocker", "cdp", `CDP 不可用：${endpoint.endpointId}`, `当前状态为 ${endpoint.status}。`, "处理登录、验证码、Profile 风险或重新启动 CDP。", [endpoint.workerId, endpoint.endpointId]));
    }
    if (!endpoint.accountId || !endpoint.profileId) {
      issues.push(issue(`cdp:missing-binding:${endpoint.endpointId}`, "blocker", "cdp", `CDP 缺少账号/Profile 绑定：${endpoint.endpointId}`, "没有绑定信息会导致任务、产物、风险无法闭环归因。", "重新打开统一标识页，确保 worker 心跳读取到账号和 Profile。", [endpoint.workerId, endpoint.endpointId]));
    }
    if (!endpoint.maskedLogin || isPlaceholder(endpoint.maskedLogin)) {
      issues.push(issue(`cdp:missing-login:${endpoint.endpointId}`, "blocker", "cdp", `CDP 缺少手机号标识：${endpoint.endpointId}`, "登录后无法确认哪个手机号对应哪个 CDP。", "在统一标识页填写脱敏手机号。", [endpoint.workerId, endpoint.endpointId]));
    }
    if (!endpoint.targetStoreName || isPlaceholder(endpoint.targetStoreName)) {
      issues.push(issue(`cdp:missing-store:${endpoint.endpointId}`, "blocker", "cdp", `CDP 缺少目标门店：${endpoint.endpointId}`, "无法确认该账号应采哪个门店，容易误采或重复采。", "在统一标识页填写本轮目标门店。", [endpoint.workerId, endpoint.endpointId]));
    }
  }

  addDuplicateChecks(issues, accounts, endpoints, profiles);
  addTaskChecks(issues, input.tasks, accounts, endpoints, workerById);
  addRiskChecks(issues, openRisks);
  addRunChecks(issues, activeRuns, input.tasks, input.stores);
  for (const run of activeRuns) {
    if (!run.scopeManifestId) {
      issues.push(issue(`run:scope-unfrozen:${run.runId}`, "blocker", "task", `批次尚未冻结采集范围：${run.runLabel}`, "系统无法确认本轮应采类目和优惠券范围，进度分母不可信。", "先从目标门店页面生成并冻结范围清单，再创建类目任务。", [run.runId, run.storeId]));
    }
  }

  const blockers = issues.filter((item) => item.severity === "blocker").length;
  const warnings = issues.filter((item) => item.severity === "warning").length;
  return {
    status: blockers ? "blocked" : warnings ? "warning" : "ready",
    generatedAt: now.toISOString(),
    summary: {
      workers: workers.length,
      onlineWorkers: workers.filter((row) => row.worker.status === "online").length,
      accounts: accounts.length,
      cdpEndpoints: endpoints.length,
      activeRuns: activeRuns.length,
      openRisks: openRisks.length,
      blockers,
      warnings
    },
    issues
  };
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split(".").slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index++) {
    if ((leftParts[index] || 0) !== (rightParts[index] || 0)) {
      return (leftParts[index] || 0) > (rightParts[index] || 0) ? 1 : -1;
    }
  }
  return 0;
}

function addDuplicateChecks(
  issues: ProductionReadinessIssue[],
  accounts: Array<{ accountId: string; displayName: string; maskedLogin?: string; workerId: string; profileId: string }>,
  endpoints: Array<{ endpointId: string; workerId: string; accountId?: string; profileId?: string; maskedLogin?: string; port: number }>,
  profiles: Array<{ profileId: string; accountId: string; workerId: string }>
): void {
  addDuplicateIssue(issues, "account:id", accounts.map((item) => ({ key: item.accountId, ref: `${item.workerId}/${item.accountId}` })), "账号 ID 重复", "同一个 accountId 被多个位置使用，会导致任务归因和风险处理混乱。");
  addDuplicateIssue(issues, "profile:id", profiles.map((item) => ({ key: item.profileId, ref: `${item.workerId}/${item.profileId}` })), "Profile ID 重复", "同一个 profileId 被多个账号或设备使用，风险状态会串扰。");
  addDuplicateIssue(issues, "cdp:endpoint", endpoints.map((item) => ({ key: item.endpointId, ref: `${item.workerId}/${item.endpointId}` })), "CDP endpoint 重复", "同一个 CDP endpoint 被重复登记，任务可能发错。");
  addDuplicateIssue(issues, "cdp:phone", endpoints.filter((item) => item.maskedLogin && !isPlaceholder(item.maskedLogin)).map((item) => ({ key: item.maskedLogin || "", ref: `${item.workerId}/${item.endpointId}` })), "手机号标识重复", "同一脱敏手机号出现在多个 CDP 上，除非明确允许，否则会造成账号混淆。");
}

function addTaskChecks(
  issues: ProductionReadinessIssue[],
  tasks: CategoryTaskRecord[],
  accounts: Array<{ accountId: string; status: string; riskLevel: string; profileId: string; profileStatus: string; workerId: string }>,
  endpoints: Array<{ endpointId: string; status: string; accountId?: string; profileId?: string; workerId: string }>,
  workerById: Map<string, WorkerStatusRow>
): void {
  const accountById = new Map(accounts.map((account) => [account.accountId, account]));
  const endpointById = new Map(endpoints.map((endpoint) => [endpoint.endpointId, endpoint]));
  const activeTasksByEndpoint = new Map<string, CategoryTaskRecord[]>();
  const activeStoreIds = new Set(tasks.filter((task) => ["pending", "assigned", "running", "paused", "manual_required"].includes(task.status)).map((task) => task.storeId));

  for (const task of tasks) {
    const cursor = (task.cursor || {}) as Record<string, unknown>;
    if (["assigned", "running"].includes(task.status) && task.assignedCdpEndpointId) {
      const list = activeTasksByEndpoint.get(task.assignedCdpEndpointId) || [];
      list.push(task);
      activeTasksByEndpoint.set(task.assignedCdpEndpointId, list);
    }
    if (!["pending", "assigned", "running", "manual_required", "paused"].includes(task.status)) continue;
    if (cursor.fixedAccountAssignment === true) {
      addFixedAssignmentChecks(issues, task, cursor);
    }
    if (
      task.status === "pending" &&
      activeStoreIds.size > 1 &&
      !task.assignedWorkerId &&
      !task.assignedAccountId &&
      !task.assignedProfileId &&
      !task.assignedCdpEndpointId
    ) {
      issues.push(issue(`task:unassigned-multi-store:${task.taskId}`, "blocker", "task", `多门店任务未绑定资源：${task.categoryName}`, "当前存在多个活跃门店，未绑定资源的 pending 任务可能被错误账号领取。", "按门店把类目任务分配到明确的 worker/account/profile/CDP 后再开采。", [task.taskId, task.storeId]));
    }
    if (task.assignedWorkerId && workerById.get(task.assignedWorkerId)?.worker.status !== "online") {
      issues.push(issue(`task:offline-worker:${task.taskId}`, "blocker", "task", `任务绑定离线 Worker：${task.categoryName}`, `任务绑定 ${task.assignedWorkerId}，但该 worker 不在线。`, "恢复 worker 或将任务重新分配。", [task.taskId, task.assignedWorkerId]));
    }
    if (task.assignedAccountId) {
      const account = accountById.get(task.assignedAccountId);
      if (!account) {
        issues.push(issue(`task:missing-account:${task.taskId}`, "blocker", "task", `任务绑定了不存在的账号：${task.categoryName}`, "任务引用的账号未在账号矩阵中登记。", "重新分配任务到有效账号。", [task.taskId, task.assignedAccountId]));
      } else if (!["safe", "running"].includes(account.status) || ["high", "blocked"].includes(account.riskLevel) || account.profileStatus !== "safe") {
        issues.push(issue(`task:risk-account:${task.taskId}`, "blocker", "task", `任务绑定风险账号：${task.categoryName}`, `账号 ${task.assignedAccountId} 当前不可安全调度。`, "更换账号/Profile 或先处理风险状态。", [task.taskId, task.assignedAccountId]));
      }
    }
    if (task.assignedCdpEndpointId) {
      const endpoint = endpointById.get(task.assignedCdpEndpointId);
      if (!endpoint) {
        issues.push(issue(`task:missing-cdp:${task.taskId}`, "blocker", "task", `任务绑定了不存在的 CDP：${task.categoryName}`, "任务引用的 CDP endpoint 未登记。", "重新分配任务到有效 CDP。", [task.taskId, task.assignedCdpEndpointId]));
      } else if (!["ready", "idle", "running"].includes(endpoint.status)) {
        issues.push(issue(`task:risk-cdp:${task.taskId}`, "blocker", "task", `任务绑定不可用 CDP：${task.categoryName}`, `CDP ${task.assignedCdpEndpointId} 当前状态为 ${endpoint.status}。`, "处理 CDP 状态或换端口/Profile。", [task.taskId, task.assignedCdpEndpointId]));
      }
    }
  }

  for (const [endpointId, rows] of activeTasksByEndpoint.entries()) {
    if (rows.length <= 1) continue;
    issues.push(issue(`task:duplicate-active-cdp:${endpointId}`, "blocker", "task", `同一 CDP 同时绑定多个运行任务：${endpointId}`, `该 CDP 当前绑定 ${rows.length} 个 assigned/running 任务。`, "保留一个任务，其余暂停或重新分配，避免同账号并发。", [endpointId, ...rows.map((row) => row.taskId)]));
  }
}

function addFixedAssignmentChecks(
  issues: ProductionReadinessIssue[],
  task: CategoryTaskRecord,
  cursor: Record<string, unknown>
): void {
  const requiredFields: Array<[keyof CategoryTaskRecord, string]> = [
    ["assignedWorkerId", "worker"],
    ["assignedAccountId", "account"],
    ["assignedProfileId", "profile"],
    ["assignedCdpEndpointId", "cdp"]
  ];
  for (const [field, label] of requiredFields) {
    if (!task[field]) {
      issues.push(issue(`task:fixed-missing-${label}:${task.taskId}`, "blocker", "task", `固定类目任务缺少 ${label} 绑定：${task.categoryName}`, "该任务声明了 fixedAccountAssignment，但绑定字段被清空，可能被错误账号领取。", "恢复任务原始 worker/account/profile/CDP 绑定，不要跨账号改派。", [task.taskId, task.storeId]));
    }
  }

  const expected: Array<[keyof CategoryTaskRecord, string, string]> = [
    ["assignedWorkerId", "fixedAssignedWorkerId", "worker"],
    ["assignedAccountId", "fixedAssignedAccountId", "account"],
    ["assignedProfileId", "fixedAssignedProfileId", "profile"],
    ["assignedCdpEndpointId", "fixedAssignedCdpEndpointId", "cdp"]
  ];
  for (const [field, cursorField, label] of expected) {
    const expectedValue = typeof cursor[cursorField] === "string" ? cursor[cursorField] : "";
    if (expectedValue && task[field] && task[field] !== expectedValue) {
      issues.push(issue(`task:fixed-mismatch-${label}:${task.taskId}`, "blocker", "task", `固定类目任务 ${label} 绑定不一致：${task.categoryName}`, `当前 ${String(task[field])}，固定值 ${expectedValue}。`, "恢复固定绑定；如确需换号，必须新建任务分配方案并留操作审计。", [task.taskId, task.storeId, String(task[field]), expectedValue]));
    }
  }
}

function addRiskChecks(issues: ProductionReadinessIssue[], openRisks: RiskEventRecord[]): void {
  for (const risk of openRisks) {
    const title = readinessRiskTitle(risk.riskType);
    const detail = readinessRiskDetail(risk);
    if (risk.severity === "critical" || risk.severity === "high") {
      issues.push(issue(`risk:open:${risk.riskId}`, "blocker", "risk", `存在未解决高危风险：${title}`, detail, "先在风控干预台处理并标记结果，再开始新一轮采集。", [risk.riskId, risk.workerId, risk.accountId || ""]));
    } else {
      issues.push(issue(`risk:open:${risk.riskId}`, "warning", "risk", `存在未解决风险：${title}`, detail, "确认该风险不影响本轮门店后再继续。", [risk.riskId, risk.workerId, risk.accountId || ""]));
    }
  }
}

function readinessRiskTitle(riskType: RiskEventRecord["riskType"]): string {
  const labels: Record<RiskEventRecord["riskType"], string> = {
    captcha: "页面需要验证码",
    identity_check: "页面需要身份核实",
    interface_403: "渠道访问受限（403）",
    interface_418: "渠道请求被限制（418）",
    account_blocked: "账号无法继续采集",
    profile_risk: "浏览器席位存在风险",
    device_risk: "采集设备存在风险",
    login_required: "账号需要重新登录",
    store_mismatch: "当前页面门店不匹配",
    store_location_mismatch: "配送位置不在目标门店附近"
  };
  return labels[riskType];
}

function readinessRiskDetail(risk: RiskEventRecord): string {
  const target = [risk.storeName, risk.categoryName].filter(Boolean).join(" / ");
  const prefix = target ? `${target}：` : "";
  const messages: Record<RiskEventRecord["riskType"], string> = {
    captcha: "页面等待人工完成验证码，任务断点已保留。",
    identity_check: "页面等待人工完成身份核实，任务断点已保留。",
    interface_403: "目标渠道拒绝本次访问，任务断点已保留。",
    interface_418: "目标渠道限制本次请求，任务断点已保留。",
    account_blocked: "当前账号无法查看目标门店商品，需要人工判断是否换号。",
    profile_risk: "当前浏览器席位不应继续分配采集任务。",
    device_risk: "当前设备不应继续分配采集任务。",
    login_required: "当前账号登录状态失效，需要人工重新登录。",
    store_mismatch: "当前浏览器页面不是任务指定门店，系统已阻止开采。",
    store_location_mismatch: "当前页面配送位置尚未确认在目标门店服务区域，系统已阻止开采。"
  };
  return `${prefix}${messages[risk.riskType]}`;
}

function addRunChecks(
  issues: ProductionReadinessIssue[],
  runs: StoreRunRecord[],
  tasks: CategoryTaskRecord[],
  stores: StoreRecord[]
): void {
  const storeById = new Map(stores.map((store) => [store.storeId, store]));
  for (const run of runs) {
    const rows = tasks.filter((task) => task.runId === run.runId);
    if (!storeById.get(run.storeId)) {
      issues.push(issue(`run:missing-store:${run.runId}`, "blocker", "store", `批次门店不存在：${run.runLabel}`, `store_id=${run.storeId} 未在门店表中找到。`, "修复门店配置或取消该批次。", [run.runId, run.storeId]));
    }
    if (!rows.length) {
      issues.push(issue(`run:no-tasks:${run.runId}`, "warning", "task", `批次没有类目任务：${run.runLabel}`, "没有类目任务时 worker 不会采集任何数据。", "先创建类目任务或取消该批次。", [run.runId]));
    }
    const categoryKeys = new Map<string, CategoryTaskRecord[]>();
    for (const task of rows) {
      const key = task.categoryName.trim();
      const list = categoryKeys.get(key) || [];
      list.push(task);
      categoryKeys.set(key, list);
    }
    for (const [categoryName, duplicated] of categoryKeys.entries()) {
      if (duplicated.length <= 1) continue;
      issues.push(issue(`run:duplicate-category:${run.runId}:${categoryName}`, "warning", "task", `同一批次类目重复：${categoryName}`, `批次 ${run.runLabel} 中该类目出现 ${duplicated.length} 次。`, "确认是否为不同入口；如不是，删除重复任务。", [run.runId, ...duplicated.map((row) => row.taskId)]));
    }
  }
}

function addDuplicateIssue(
  issues: ProductionReadinessIssue[],
  id: string,
  rows: Array<{ key: string; ref: string }>,
  title: string,
  detail: string
): void {
  const buckets = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    const list = buckets.get(key) || [];
    list.push(row.ref);
    buckets.set(key, list);
  }
  for (const [key, refs] of buckets.entries()) {
    if (refs.length <= 1) continue;
    issues.push(issue(`${id}:${key}`, "blocker", "system", `${title}：${key}`, detail, "修改配置，确保每个账号/Profile/CDP 在本轮采集中唯一。", refs));
  }
}

function issue(
  id: string,
  severity: ProductionReadinessIssue["severity"],
  area: ProductionReadinessIssue["area"],
  title: string,
  detail: string,
  action: string,
  refs?: string[]
): ProductionReadinessIssue {
  return { id, severity, area, title, detail, action, refs: refs?.filter(Boolean) };
}

function isPlaceholder(value: unknown): boolean {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return true;
  return (
    text === "test" ||
    text === "demo" ||
    text === "sample" ||
    text === "profile" ||
    text === "待填写" ||
    text === "login-pending" ||
    text.includes("debug") ||
    text.includes("default account") ||
    text.includes("account-01")
  );
}
