import { createHmac } from "node:crypto";

export interface AccountSourceRecord {
  phone: string;
  owner: string;
  displayName: string;
  department?: string;
  minimumCooldownHours?: number;
  requestedState?: string;
  resolutionNote?: string;
}

export interface AccountRegistryDto {
  displayName: string;
  maskedLogin: string;
  phoneFingerprint: string;
  operatorOwner: string;
  department?: string;
  minimumCooldownHours?: number;
  requestedState?: string;
  resolutionNote?: string;
}

export function mapAccountRecord(record: AccountSourceRecord, hmacKey: string): AccountRegistryDto {
  if (hmacKey.length < 32) throw new Error("account_hmac_key_too_short");
  const normalizedPhone = record.phone.replace(/[\s-]/g, "");
  if (!/^1\d{10}$/.test(normalizedPhone)) throw new Error("invalid_account_phone");
  if (!record.owner?.trim() || !record.displayName?.trim()) throw new Error("missing_account_identity");

  return {
    displayName: record.displayName.trim(),
    maskedLogin: `${normalizedPhone.slice(0, 3)}****${normalizedPhone.slice(-4)}`,
    phoneFingerprint: createHmac("sha256", hmacKey).update(normalizedPhone).digest("hex"),
    operatorOwner: record.owner.trim(),
    department: emptyToUndefined(record.department),
    minimumCooldownHours: record.minimumCooldownHours,
    requestedState: emptyToUndefined(record.requestedState),
    resolutionNote: emptyToUndefined(record.resolutionNote)
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
