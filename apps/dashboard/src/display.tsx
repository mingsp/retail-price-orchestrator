import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  FileCode,
  FileImage,
  FileText,
  HelpCircle,
  Lock,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  UserCheck,
  UserX,
  Wifi,
  WifiOff,
  Zap
} from "lucide-react";
import type { ReactNode } from "react";

const statusLabels: Record<string, string> = {
  online: "在线",
  connecting: "连接中",
  live: "实时在线",
  disconnected: "连接已断开",
  "ws-error": "同步连接异常",
  "http-error": "数据服务异常",
  offline: "离线",
  degraded: "降级",
  device_risk: "设备风险",
  safe: "安全",
  unknown: "未知",
  idle: "空闲",
  ready: "就绪",
  available: "可用",
  reserved: "已预留",
  in_use: "使用中",
  running: "运行中",
  cooldown: "冷却",
  risk: "风险",
  manual_required: "需人工",
  account_blocked: "账号封禁",
  retired: "停用",
  profile_risk: "浏览器席位风险",
  normal: "正常",
  watch: "观察",
  high: "高风险",
  blocked: "阻断",
  active: "启用",
  paused: "已暂停",
  planned: "已计划",
  pending: "待领取",
  assigned: "已分配",
  collecting: "采集中",
  captured: "原始数据已捕获",
  uploading: "产物上传中",
  structuring: "商品结构化中",
  validating: "完整性核对中",
  completed: "采集结束待校验",
  completed_valid: "有效完成",
  needs_review: "待人工复核",
  failed: "失败",
  cancelled: "已取消",
  skipped: "已跳过",
  open: "待处理",
  acknowledged: "已确认",
  resolved: "已解决",
  low: "低",
  medium: "中",
  critical: "严重",
  raw_jsonl: "商品原始数据",
  screenshot: "截图",
  log: "日志",
  export: "导出文件",
  other: "其他",
  pass: "通过",
  warn: "警告",
  fail: "失败",
  captcha: "验证码",
  identity_check: "身份核实",
  interface_403: "接口403",
  interface_418: "接口418",
  login_required: "需要登录",
  quarantine: "隔离"
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
  if (value === undefined || value === null || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function getStatusIcon(status: string): ReactNode {
  const s = status?.toLowerCase() || "";
  switch (s) {
    case "online":
    case "safe":
    case "completed_valid":
    case "ready":
    case "pass":
    case "normal":
    case "active":
    case "available":
    case "resolved":
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
    case "running":
    case "in_use":
    case "assigned":
    case "collecting":
    case "captured":
    case "uploading":
    case "structuring":
    case "validating":
      return <Activity className="h-3.5 w-3.5 shrink-0 text-blue-600" />;
    case "pending":
    case "planned":
    case "reserved":
    case "idle":
    case "open":
    case "watch":
    case "acknowledged":
    case "completed":
      return <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" />;
    case "manual_required":
    case "needs_review":
    case "degraded":
    case "cooldown":
    case "warn":
    case "login_required":
    case "captcha":
    case "identity_check":
      return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />;
    case "device_risk":
    case "risk":
    case "profile_risk":
    case "account_blocked":
    case "failed":
    case "cancelled":
    case "high":
    case "critical":
    case "blocked":
    case "fail":
    case "retired":
    case "quarantine":
    case "interface_403":
    case "interface_418":
    case "offline":
      return <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-rose-600" />;
    case "raw_jsonl":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-slate-600" />;
    case "screenshot":
      return <FileImage className="h-3.5 w-3.5 shrink-0 text-slate-600" />;
    case "log":
      return <FileText className="h-3.5 w-3.5 shrink-0 text-slate-600" />;
    case "export":
    case "other":
      return <Database className="h-3.5 w-3.5 shrink-0 text-slate-600" />;
    case "paused":
      return <PauseCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />;
    case "skipped":
      return <SkipForward className="h-3.5 w-3.5 shrink-0 text-slate-500" />;
    case "live":
      return <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
    case "disconnected":
    case "ws-error":
    case "http-error":
      return <WifiOff className="h-3.5 w-3.5 shrink-0 text-rose-600" />;
    default:
      return <HelpCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
  }
}

export function StatusPill({ status, className = "" }: { status: string; className?: string }) {
  const label = labelStatus(status);
  const icon = getStatusIcon(status);
  return (
    <span className={`pill pill-${status} ${className}`}>
      {icon}
      <span>{label}</span>
    </span>
  );
}
