import { spawn } from "node:child_process";

export type DwsExecutor = (args: string[]) => Promise<unknown>;

export interface DwsRecord {
  recordId: string;
  cells: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DwsField {
  fieldId: string;
  fieldName: string;
  type: string;
  [key: string]: unknown;
}

export interface DwsUser {
  userId: string;
  displayName: string;
  department?: string;
}

export interface DwsRecordWrite {
  recordId?: string;
  cells: Record<string, unknown>;
}

export function createDwsClient(execute: DwsExecutor = executeDwsJson) {
  return {
    async queryAllRecords(baseId: string, tableId: string): Promise<DwsRecord[]> {
      assertStableId(baseId, "invalid_dws_base_id");
      assertStableId(tableId, "invalid_dws_table_id");
      const result = await execute([
        "aitable", "record", "query",
        "--base-id", baseId,
        "--table-id", tableId,
        "--all", "--page-limit", "0",
        "--format", "json"
      ]);
      return extractCompleteRecords(result);
    },
    async queryFields(baseId: string, tableId: string): Promise<DwsField[]> {
      assertStableId(baseId, "invalid_dws_base_id");
      assertStableId(tableId, "invalid_dws_table_id");
      const result = await execute([
        "aitable", "field", "get",
        "--base-id", baseId,
        "--table-id", tableId,
        "--format", "json"
      ]);
      return extractFields(result);
    },
    async queryUsers(userIds: string[]): Promise<DwsUser[]> {
      const normalized = [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))];
      for (const userId of normalized) assertStableId(userId, "invalid_dws_user_id");
      const users: DwsUser[] = [];
      for (let offset = 0; offset < normalized.length; offset += 30) {
        const batch = normalized.slice(offset, offset + 30);
        const result = await execute([
          "contact", "user", "get",
          "--ids", batch.join(","),
          "--format", "json"
        ]);
        users.push(...extractUsers(result));
      }
      return [...new Map(users.map((user) => [user.userId, user])).values()];
    },
    async createRecords(baseId: string, tableId: string, records: DwsRecordWrite[]): Promise<string[]> {
      assertStableId(baseId, "invalid_dws_base_id");
      assertStableId(tableId, "invalid_dws_table_id");
      assertWriteBatch(records, false);
      const result = await execute([
        "aitable", "record", "create",
        "--base-id", baseId,
        "--table-id", tableId,
        "--records", JSON.stringify(records.map(({ cells }) => ({ cells }))),
        "--format", "json"
      ]);
      return extractCreatedRecordIds(result);
    },
    async updateRecords(baseId: string, tableId: string, records: DwsRecordWrite[]): Promise<void> {
      assertStableId(baseId, "invalid_dws_base_id");
      assertStableId(tableId, "invalid_dws_table_id");
      assertWriteBatch(records, true);
      await execute([
        "aitable", "record", "update",
        "--base-id", baseId,
        "--table-id", tableId,
        "--records", JSON.stringify(records),
        "--format", "json"
      ]);
    }
  };
}

export async function executeDwsJson(args: string[], timeoutMs = 60_000): Promise<unknown> {
  const invocation = resolveDwsInvocation(process.platform, process.env.DWS_EXECUTABLE, args);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const maximumOutputBytes = 16 * 1024 * 1024;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("dws_command_timeout"));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > maximumOutputBytes) child.kill();
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr, "utf8") > maximumOutputBytes) child.kill();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`dws_process_error:${redactSensitiveText(error.message)}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (Buffer.byteLength(stdout, "utf8") > maximumOutputBytes || Buffer.byteLength(stderr, "utf8") > maximumOutputBytes) {
        reject(new Error("dws_output_limit_exceeded"));
        return;
      }
      if (code !== 0) {
        reject(new Error(`dws_command_failed:${code ?? "unknown"}:${redactSensitiveText(stderr).slice(0, 1_000)}`));
        return;
      }
      try {
        resolve(parseDwsJson(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function resolveDwsInvocation(platform: NodeJS.Platform, configuredExecutable: string | undefined, args: string[]) {
  const executable = configuredExecutable || (platform === "win32" ? "dws.cmd" : "dws");
  if (platform === "win32" && executable.toLowerCase().endsWith(".ps1")) {
    return {
      executable: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", executable, ...args]
    };
  }
  return { executable, args };
}

export function parseDwsJson(value: string): unknown {
  try {
    return JSON.parse(value.trim());
  } catch {
    throw new Error("dws_invalid_json");
  }
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\b1\d{10}\b/g, "[REDACTED_PHONE]")
    .replace(/(access_token|token|authorization)(\s*[=:]\s*)([^\s&]+)/gi, "$1$2[REDACTED]");
}

function extractCompleteRecords(value: unknown): DwsRecord[] {
  if (!value || typeof value !== "object") throw new Error("dws_invalid_record_result");
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  if (root.partial === true || data.partial === true) throw new Error("dws_partial_result");
  const nextCursor = data.nextCursor ?? root.nextCursor;
  if (root.hasMore === true || data.hasMore === true || (typeof nextCursor === "string" && nextCursor.length > 0)) {
    throw new Error("dws_incomplete_pagination");
  }
  const records = Object.hasOwn(data, "records") ? data.records : root.records;
  if (records === null && Number(data.totalCount ?? root.totalCount ?? 0) === 0) return [];
  if (!Array.isArray(records)) throw new Error("dws_records_missing");
  return records as DwsRecord[];
}

function extractFields(value: unknown): DwsField[] {
  if (!value || typeof value !== "object") throw new Error("dws_invalid_field_result");
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  if (root.partial === true || data.partial === true) throw new Error("dws_partial_result");
  const fields = data.fields ?? root.fields;
  if (!Array.isArray(fields)) throw new Error("dws_fields_missing");
  return fields.map((field) => {
    if (!field || typeof field !== "object") throw new Error("dws_invalid_field_result");
    const current = field as Record<string, unknown>;
    if (typeof current.fieldId !== "string" || typeof current.fieldName !== "string" || typeof current.type !== "string") {
      throw new Error("dws_invalid_field_result");
    }
    return current as DwsField;
  });
}

function extractUsers(value: unknown): DwsUser[] {
  if (!value || typeof value !== "object") throw new Error("dws_invalid_user_result");
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  const result = data.result ?? root.result;
  if (!Array.isArray(result)) throw new Error("dws_users_missing");
  return result.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("dws_invalid_user_result");
    const current = entry as Record<string, unknown>;
    const model = current.orgEmployeeModel && typeof current.orgEmployeeModel === "object"
      ? current.orgEmployeeModel as Record<string, unknown>
      : current;
    const userId = String(model.orgUserId ?? model.userId ?? "").trim();
    const displayName = String(model.orgUserName ?? model.name ?? "").trim();
    if (!userId || !displayName) throw new Error("dws_invalid_user_result");
    assertStableId(userId, "invalid_dws_user_id");
    const departments = Array.isArray(model.depts) ? model.depts : [];
    const department = departments
      .map((departmentValue) => {
        if (!departmentValue || typeof departmentValue !== "object") return "";
        const departmentObject = departmentValue as Record<string, unknown>;
        return String(departmentObject.deptPathName ?? departmentObject.deptName ?? "").trim();
      })
      .find(Boolean);
    return { userId, displayName, ...(department ? { department } : {}) };
  });
}

function assertStableId(value: string, errorCode: string) {
  if (!/^[A-Za-z0-9_-]{3,200}$/.test(value)) throw new Error(errorCode);
}

function assertWriteBatch(records: DwsRecordWrite[], requireRecordId: boolean): void {
  if (!Array.isArray(records) || records.length < 1 || records.length > 30) throw new Error("dws_record_batch_limit");
  for (const record of records) {
    if (requireRecordId && !record.recordId?.trim()) throw new Error("dws_record_id_required");
    if (record.recordId) assertStableId(record.recordId, "invalid_dws_record_id");
    if (!record.cells || typeof record.cells !== "object" || Array.isArray(record.cells)) throw new Error("dws_record_cells_required");
    for (const [fieldId, value] of Object.entries(record.cells)) {
      assertStableId(fieldId, "invalid_dws_field_id");
      assertSafeWriteValue(value);
    }
  }
}

function assertSafeWriteValue(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/\b1\d{10}\b/.test(serialized)) throw new Error("dws_restricted_phone_write");
  if (/access_token\s*=/i.test(serialized)) throw new Error("dws_restricted_token_write");
  if (/[A-Za-z]:\\(?:[^\s\\]+\\)+/.test(serialized)) throw new Error("dws_restricted_path_write");
}

function extractCreatedRecordIds(value: unknown): string[] {
  if (!value || typeof value !== "object") throw new Error("dws_invalid_record_create_result");
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  if (!Array.isArray(data.newRecordIds) || data.newRecordIds.some((id) => typeof id !== "string")) {
    throw new Error("dws_invalid_record_create_result");
  }
  return data.newRecordIds as string[];
}
