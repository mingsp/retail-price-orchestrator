import type { RiskEventRecord } from "@retail-orchestrator/shared";

export type NotificationStatus =
  | "pending"
  | "delivering"
  | "sent"
  | "retryable_failure"
  | "outcome_unknown"
  | "dead_letter";

export interface NotificationDraft {
  dedupeKey: string;
  channel: "dingtalk";
  eventType: string;
  message: string;
  payload: Record<string, unknown>;
}

export interface NotificationDelivery {
  notificationId: string;
  dedupeKey: string;
  channel: "dingtalk";
  eventType: string;
  message: string;
  attemptCount: number;
}

export interface DingTalkResponse {
  statusCode: number;
  body: unknown;
}

export interface RunMilestoneNotification {
  threshold: 50 | 100;
  storeName?: string;
  storeId: string;
  runId: string;
  recordedItems: number;
  validatedCategories: number;
  totalCategories: number;
}

export interface DeliveryResult {
  status: "sent" | "retryable_failure" | "outcome_unknown";
  retryable: boolean;
  providerCode?: string;
  providerMessage?: string;
}

export interface NotificationDeliveryStore {
  claimNext(): Promise<NotificationDelivery | null>;
  markSent(delivery: NotificationDelivery, result: DeliveryResult): Promise<unknown>;
  markRetryableFailure(delivery: NotificationDelivery, result: DeliveryResult): Promise<unknown>;
  markOutcomeUnknown(delivery: NotificationDelivery, result: DeliveryResult): Promise<unknown>;
}

export function buildRiskNotification(risk: RiskEventRecord): NotificationDraft {
  const account = maskPhoneLikeValue(risk.accountId || "未识别");
  const message = sanitizeNotificationText([
    "商圈比价 风险提醒",
    `设备: ${risk.workerId}`,
    `账号: ${account}`,
    risk.cdpPort ? `浏览器席位: ${risk.cdpPort}` : "",
    risk.storeName || risk.storeId ? `门店: ${risk.storeName || risk.storeId}` : "",
    risk.categoryName ? `类目: ${risk.categoryName}` : "",
    `异常: ${risk.observed}`,
    "处理: 请定位到对应浏览器完成人工处理"
  ].filter(Boolean).join("\n"));

  return {
    dedupeKey: `risk:${risk.riskId}:opened`,
    channel: "dingtalk",
    eventType: "risk.opened",
    message,
    payload: {
      riskId: risk.riskId,
      workerId: risk.workerId,
      storeId: risk.storeId,
      categoryName: risk.categoryName,
      severity: risk.severity
    }
  };
}

export function buildRunMilestoneNotification(milestone: RunMilestoneNotification): NotificationDraft {
  const message = sanitizeNotificationText([
    `商圈比价 采集进度 ${milestone.threshold}%`,
    `门店: ${milestone.storeName || milestone.storeId}`,
    `已完成类目: ${milestone.validatedCategories}/${milestone.totalCategories}`,
    `已采商品记录: ${milestone.recordedItems}`
  ].join("\n"));
  return {
    dedupeKey: `run:${milestone.runId}:milestone:${milestone.threshold}`,
    channel: "dingtalk",
    eventType: `run.milestone.${milestone.threshold}`,
    message,
    payload: {
      runId: milestone.runId,
      storeId: milestone.storeId,
      threshold: milestone.threshold,
      recordedItems: milestone.recordedItems,
      validatedCategories: milestone.validatedCategories,
      totalCategories: milestone.totalCategories
    }
  };
}

export function classifyDingTalkDelivery(statusCode: number, body: unknown): Omit<DeliveryResult, "retryable"> {
  const parsed = asProviderBody(body);
  if (statusCode >= 200 && statusCode < 300 && parsed.errcode === 0) {
    return {
      status: "sent",
      providerCode: "0",
      providerMessage: parsed.errmsg || "ok"
    };
  }
  return {
    status: "retryable_failure",
    providerCode: parsed.errcode === undefined ? String(statusCode) : String(parsed.errcode),
    providerMessage: parsed.errmsg || `HTTP ${statusCode}`
  };
}

export async function deliverNotification(
  delivery: NotificationDelivery,
  transport: (delivery: NotificationDelivery) => Promise<DingTalkResponse>
): Promise<DeliveryResult> {
  try {
    const response = await transport(delivery);
    const classified = classifyDingTalkDelivery(response.statusCode, response.body);
    return { ...classified, retryable: classified.status === "retryable_failure" };
  } catch (error) {
    return {
      status: "outcome_unknown",
      retryable: false,
      providerMessage: safeErrorMessage(error)
    };
  }
}

export async function dispatchNextNotification(
  store: NotificationDeliveryStore,
  transport: (delivery: NotificationDelivery) => Promise<DingTalkResponse>
): Promise<boolean> {
  const delivery = await store.claimNext();
  if (!delivery) return false;

  const result = await deliverNotification(delivery, transport);
  if (result.status === "sent") {
    await store.markSent(delivery, result);
  } else if (result.status === "retryable_failure") {
    await store.markRetryableFailure(delivery, result);
  } else {
    await store.markOutcomeUnknown(delivery, result);
  }
  return true;
}

export function sanitizeNotificationText(value: string): string {
  return value
    .replace(/https?:\/\/oapi\.dingtalk\.com\/robot\/send\?access_token=[^\s]+/gi, "[机器人地址已隐藏]")
    .replace(/[A-Za-z]:\\(?:[^\s\\]+\\)+[^\s]*/g, "[本机路径已隐藏]")
    .replace(/(?<!\d)(1\d{2})\d{4}(\d{4})(?!\d)/g, "$1****$2")
    .trim();
}

function maskPhoneLikeValue(value: string): string {
  return value.replace(/(?<!\d)(1\d{2})\d{4}(\d{4})(?!\d)/g, "$1****$2");
}

function asProviderBody(body: unknown): { errcode?: number; errmsg?: string } {
  if (!body || typeof body !== "object") return {};
  const value = body as Record<string, unknown>;
  return {
    errcode: typeof value.errcode === "number" ? value.errcode : undefined,
    errmsg: typeof value.errmsg === "string" ? sanitizeNotificationText(value.errmsg) : undefined
  };
}

function safeErrorMessage(error: unknown): string {
  return sanitizeNotificationText(error instanceof Error ? error.message : String(error));
}
