import type { BusinessDeliveryRecord, RunProgressRecord } from "@retail-orchestrator/shared";

export function businessRunStatus(status: RunProgressRecord["status"]): string {
  return {
    planned: "等待采集",
    running: "采集中",
    paused: "等待处理",
    completed: "已完成",
    failed: "采集未完成",
    cancelled: "已取消"
  }[status];
}

export function deliveryStatus(status: BusinessDeliveryRecord["status"]): string {
  return {
    collecting: "采集中",
    checking: "完整性核对中",
    ready: "可交付",
    attention: "需要处理"
  }[status];
}

export function formatBusinessTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}
