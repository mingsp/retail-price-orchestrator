const statusLabels: Record<string, string> = {
  online: "在线",
  offline: "离线",
  degraded: "降级",
  device_risk: "设备风险",
  safe: "安全",
  running: "运行中",
  cooldown: "冷却",
  manual_required: "需人工",
  account_blocked: "账号封禁",
  retired: "停用",
  profile_risk: "Profile风险",
  normal: "正常",
  watch: "观察",
  high: "高风险",
  blocked: "阻断",
  active: "启用",
  paused: "已暂停",
  planned: "已计划",
  pending: "待领取",
  assigned: "已分配",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  skipped: "已跳过",
  open: "待处理",
  acknowledged: "已确认",
  resolved: "已解决",
  low: "低",
  medium: "中",
  critical: "严重",
  raw_jsonl: "原始JSONL",
  screenshot: "截图",
  log: "日志",
  export: "导出文件",
  other: "其他",
  captcha: "验证码",
  identity_check: "身份核实",
  interface_403: "接口403",
  interface_418: "接口418",
  login_required: "需要登录"
};

const connectionLabels: Record<string, string> = {
  connecting: "连接中",
  live: "实时在线",
  disconnected: "已断开",
  "ws-error": "实时连接异常",
  "http-error": "接口异常"
};

export function labelStatus(status: string): string {
  return statusLabels[status] || status;
}

export function labelConnection(status: string): string {
  return connectionLabels[status] || status;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}
