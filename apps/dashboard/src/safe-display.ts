const windowsPath = /\b[A-Za-z]:[\\/][^\s;"']+/g;
const networkPath = /\\\\[^\s;"']+/g;
const unixPath = /(?:\/Users|\/home|\/tmp|\/var|\/opt|\/Applications|\/Volumes|\/private|\/Library)\/[^\s;"']+/g;
const webUrl = /https?:\/\/[^\s)\]}]+/g;
const internalCode = /\b(?:request_?code|response_?code|requestCode|responseCode)\s*[=:]\s*[A-Za-z0-9_-]+/gi;
const internalLocation = /\b(?:objectKey|outputDir|resumeFile|checkpointPath|profilePath)\s*[=:]\s*[^\s;"']+/gi;

export function safeOperationalText(value: string | undefined | null, fallback = "详细信息已记录，可按建议操作。") {
  if (!value) return fallback;
  const safe = value
    .replace(windowsPath, "[本地文件已保留]")
    .replace(networkPath, "[网络文件已保留]")
    .replace(unixPath, "[本地文件已保留]")
    .replace(webUrl, "[页面地址已记录]")
    .replace(internalCode, "[内部请求标识已记录]")
    .replace(internalLocation, "[内部存储位置已记录]")
    .replace(/\s+/g, " ")
    .trim();
  return safe || fallback;
}

export function artifactDisplayName(kind: string): string {
  if (kind === "raw_jsonl") return "商品原始数据";
  if (kind === "screenshot") return "异常现场截图";
  if (kind === "log") return "采集运行记录";
  if (kind === "export") return "业务导出文件";
  return "采集过程文件";
}
