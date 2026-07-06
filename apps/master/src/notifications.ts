import type { RiskEventRecord } from "@retail-orchestrator/shared";

export async function notifyRiskEvent(webhookUrl: string | undefined, risk: RiskEventRecord): Promise<void> {
  if (!webhookUrl) return;

  const text = [
    "采集风险事件",
    `类型: ${risk.riskType}`,
    `级别: ${risk.severity}`,
    `Worker: ${risk.workerId}`,
    risk.accountId ? `账号: ${risk.accountId}` : "",
    risk.profileId ? `Profile: ${risk.profileId}` : "",
    risk.cdpPort ? `CDP: ${risk.cdpPort}` : "",
    risk.storeName || risk.storeId ? `门店: ${risk.storeName || risk.storeId}` : "",
    risk.categoryName ? `类目: ${risk.categoryName}` : "",
    `现象: ${risk.observed}`,
    `建议: ${risk.recommendedAction}`
  ].filter(Boolean).join("\n");

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "text",
      text: { content: text }
    })
  });

  if (!response.ok) {
    throw new Error(`dingtalk notification failed: ${response.status}`);
  }
}
