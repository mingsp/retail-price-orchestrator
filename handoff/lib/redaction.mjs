const scanRules = [
  {
    id: "full-phone",
    regex: /(?:phone|mobile|login|accountLabel|手机号|电话|联系人)\s*[:=：]?\s*["']?(1[3-9]\d{9})/giu
  },
  {
    id: "dingtalk-access-token",
    regex: /https:\/\/oapi\.dingtalk\.com\/robot\/send\?access_token=[A-Za-z0-9_-]{8,}/giu
  },
  {
    id: "cookie-header",
    regex: /\bCookie\s*:\s*[A-Za-z0-9_.-]+\s*=[^;\s\r\n]+(?:\s*;\s*[A-Za-z0-9_.-]+\s*=[^;\s\r\n]+)*/giu
  },
  {
    id: "authorization-header",
    regex: /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+(?:<[^>\r\n]+>|\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|[A-Za-z0-9._~+/=-]+)/giu
  },
  {
    id: "windows-user-path",
    regex: /\b[A-Za-z]:\\Users\\[^\\\s"']+(?:\\[^\r\n"']*)?/gu
  },
  {
    id: "mac-user-path",
    regex: /\/Users\/[^/\s"']+(?:\/[^\r\n"']*)?/gu
  },
  {
    id: "private-key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu
  }
];

const droppedKeyPattern =
  /^(?:authorization|cookie|cookies|token|access[_-]?token|refresh[_-]?token|webhook|webhookUrl|request[_-]?code|response[_-]?code|requestCode|responseCode|uuid|wm_uuid|wm_visitid)$/i;

const pathKeyPattern = /(?:profilePath|userDataDir|homeDir|absolutePath|localPath)$/i;
const urlKeyPattern = /(?:url|href|endpoint)$/i;
const idKeyPattern = /(?:^id$|_id$|Id$|IdStr$|_id_str$)/;

export function scanText(text, source = "<memory>") {
  const value = String(text || "");
  const findings = [];
  for (const rule of scanRules) {
    rule.regex.lastIndex = 0;
    for (const match of value.matchAll(rule.regex)) {
      if (isAllowedPlaceholder(rule.id, match[0])) continue;
      const start = match.index || 0;
      const prefix = value.slice(0, start);
      const line = prefix.split(/\r?\n/).length;
      const lineStart = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("\r")) + 1;
      findings.push({
        source,
        ruleId: rule.id,
        line,
        column: start - lineStart + 1,
        preview: maskFinding(match[0])
      });
    }
  }
  return findings.sort((left, right) => left.line - right.line || left.column - right.column);
}

function isAllowedPlaceholder(ruleId, value) {
  if (ruleId !== "authorization-header") return false;
  const credential = String(value).replace(
    /^\s*Authorization\s*:\s*(?:Bearer|Basic)\s+/iu,
    ""
  );
  return (
    /^<[^>]+>$/.test(credential) ||
    /^\$\{[^}]+\}$/.test(credential) ||
    /^\$[A-Z_][A-Z0-9_]*$/.test(credential) ||
    /^[A-Z_][A-Z0-9_]*$/.test(credential)
  );
}

export function createSanitizer() {
  const mappings = new Map();
  const counters = new Map();

  function mapped(kind, value) {
    const source = String(value ?? "");
    const key = `${kind}:${source}`;
    if (mappings.has(key)) return mappings.get(key);
    const next = (counters.get(kind) || 0) + 1;
    counters.set(kind, next);
    const result = `sample-${kind}-${String(next).padStart(2, "0")}`;
    mappings.set(key, result);
    return result;
  }

  function sanitize(value, path = []) {
    if (Array.isArray(value)) {
      return value.map((item, index) => sanitize(item, [...path, String(index)]));
    }
    if (!value || typeof value !== "object") {
      if (typeof value === "string") return sanitizeString(value);
      return value;
    }

    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      if (droppedKeyPattern.test(key)) continue;
      const nextPath = [...path, key];

      if (pathKeyPattern.test(key)) {
        output[key] = "<REDACTED_PROFILE_PATH>";
        continue;
      }
      if (key === "workerId") {
        output[key] = "sample-worker-01";
        continue;
      }
      if (key === "slotId" || key === "browserSlotId" || key === "endpointId") {
        output[key] = "sample-slot-01";
        continue;
      }
      if (key === "accountId" || key === "accountLabel" || key === "operatorOwner") {
        output[key] = "sample-account-01";
        continue;
      }
      if (key === "profileId") {
        output[key] = "sample-profile-01";
        continue;
      }
      if (key === "storeId") {
        output[key] = "sample-store-01";
        continue;
      }
      if (key === "storeName" || key === "poiName") {
        output[key] = "脱敏示例门店";
        continue;
      }
      if (key === "cdpPort" || key === "port") {
        output[key] = 19221;
        continue;
      }
      if (key === "cdpEndpoint" || key === "endpointUrl") {
        output[key] = "http://127.0.0.1:19221";
        continue;
      }
      if (key === "runId" || key === "captureId") {
        output[key] = "sample-run-01";
        continue;
      }
      if (key === "taskId") {
        output[key] = mapped("task", nested);
        continue;
      }
      if (urlKeyPattern.test(key) && typeof nested === "string" && /^https?:\/\//i.test(nested)) {
        output[key] = "https://example.invalid/store/sample-store-01";
        continue;
      }
      if (idKeyPattern.test(key) && (typeof nested === "string" || typeof nested === "number")) {
        output[key] = mapIdentifier(key, nested, nextPath, mapped);
        continue;
      }
      if (key === "tag" && (typeof nested === "string" || typeof nested === "number")) {
        output[key] = mapped("category", nested);
        continue;
      }

      output[key] = sanitize(nested, nextPath);
    }
    return output;
  }

  return sanitize;
}

export function sanitizeCaptureRecord(record) {
  return createSanitizer()(record);
}

function mapIdentifier(key, value, path, mapped) {
  const pathText = path.join(".").toLowerCase();
  if (pathText.includes("sku")) return mapped("sku", value);
  if (pathText.includes("product") || pathText.includes("spu")) return mapped("spu", value);
  if (pathText.includes("category") || pathText.includes("tag")) return mapped("category", value);
  if (pathText.includes("coupon")) return mapped("coupon", value);
  return mapped("id", `${key}:${value}`);
}

function sanitizeString(value) {
  if (/^https?:\/\//i.test(value)) return "https://example.invalid/assets/sample";
  if (/\b[A-Za-z]:\\Users\\/i.test(value) || /\/Users\/[^/]+/i.test(value)) {
    return "<REDACTED_LOCAL_PATH>";
  }
  return value.replace(/1[3-9]\d{9}/g, "138****0000");
}

function maskFinding(value) {
  if (value.length <= 12) return "<REDACTED>";
  return `${value.slice(0, 4)}...<REDACTED>...${value.slice(-4)}`;
}
