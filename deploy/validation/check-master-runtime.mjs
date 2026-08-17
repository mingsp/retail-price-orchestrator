const baseUrl = process.env.RUNTIME_CHECK_BASE_URL || "http://127.0.0.1:17890";
const token = process.env.OPERATOR_TOKEN;
if (!token) throw new Error("operator_token_missing");

async function read(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "x-retail-operator-token": token },
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`runtime_check_failed:${path}:${response.status}`);
  return body;
}

const [ready, workerPayload, notificationPayload, readinessPayload] = await Promise.all([
  fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(10_000) }).then((response) => response.json()),
  read("/api/workers"),
  read("/api/notification-deliveries/status"),
  read("/api/production-readiness")
]);

process.stdout.write(`${JSON.stringify({
  ready: ready.ok === true,
  workers: (workerPayload.workers || []).map((row) => ({
    workerId: row.worker?.workerId,
    machineLabel: row.worker?.machineLabel,
    status: row.worker?.status,
    agentVersion: row.worker?.agentVersion,
    currentIp: row.worker?.currentIp,
    accountCount: Array.isArray(row.accounts) ? row.accounts.length : 0,
    cdpEndpointCount: Array.isArray(row.cdpEndpoints) ? row.cdpEndpoints.length : 0
  })),
  notificationSummary: notificationPayload.summary || {},
  notificationAttentionCount: Array.isArray(notificationPayload.attention) ? notificationPayload.attention.length : 0,
  productionReadiness: {
    status: readinessPayload.report?.status,
    blockerIds: (readinessPayload.report?.issues || [])
      .filter((item) => item.severity === "blocker")
      .map((item) => item.id)
  }
})}\n`);
