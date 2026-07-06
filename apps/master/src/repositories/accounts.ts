import type {
  AccountRegistryRow,
  AccountStatusUpdate,
  ProfileRegistryRow,
  ProfileStatusUpdate
} from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export async function listAccounts(db: Pool): Promise<AccountRegistryRow[]> {
  const result = await db.query(`
    SELECT a.*, p.profile_path, p.status AS profile_status
    FROM accounts a
    LEFT JOIN profiles p ON p.profile_id = a.profile_id
    ORDER BY a.worker_id ASC, a.account_id ASC
  `);

  return result.rows.map((row) => ({
    accountId: row.account_id,
    workerId: row.worker_id,
    displayName: row.display_name,
    maskedLogin: row.masked_login || undefined,
    status: row.status,
    riskLevel: row.risk_level,
    profileId: row.profile_id,
    profileStatus: row.profile_status || "safe",
    profilePath: row.profile_path || "",
    cdpPort: row.cdp_port,
    currentStoreId: row.current_store_id || undefined,
    currentStoreName: row.current_store_name || undefined,
    currentCategoryName: row.current_category_name || undefined,
    lastVerifiedAt: row.last_verified_at?.toISOString(),
    lastRiskAt: row.last_risk_at?.toISOString(),
    updatedAt: row.updated_at.toISOString()
  }));
}

export async function getAccount(db: Pool, accountId: string): Promise<AccountRegistryRow | null> {
  const accounts = await listAccounts(db);
  return accounts.find((account) => account.accountId === accountId) || null;
}

export async function updateAccountStatus(
  db: Pool,
  accountId: string,
  update: AccountStatusUpdate
): Promise<AccountRegistryRow | null> {
  await db.query(
    `
    UPDATE accounts SET
      status = COALESCE($2, status),
      risk_level = COALESCE($3, risk_level),
      current_store_id = CASE WHEN $4::boolean THEN $5 ELSE current_store_id END,
      current_store_name = CASE WHEN $6::boolean THEN $7 ELSE current_store_name END,
      current_category_name = CASE WHEN $8::boolean THEN $9 ELSE current_category_name END,
      last_verified_at = CASE WHEN $10::boolean THEN $11 ELSE last_verified_at END,
      last_risk_at = CASE WHEN $12::boolean THEN $13 ELSE last_risk_at END,
      updated_at = now()
    WHERE account_id = $1
    `,
    [
      accountId,
      update.status || null,
      update.riskLevel || null,
      "currentStoreId" in update,
      update.currentStoreId || null,
      "currentStoreName" in update,
      update.currentStoreName || null,
      "currentCategoryName" in update,
      update.currentCategoryName || null,
      "lastVerifiedAt" in update,
      update.lastVerifiedAt || null,
      "lastRiskAt" in update,
      update.lastRiskAt || null
    ]
  );
  return getAccount(db, accountId);
}

export async function listProfiles(db: Pool): Promise<ProfileRegistryRow[]> {
  const result = await db.query(`
    SELECT *
    FROM profiles
    ORDER BY worker_id ASC, profile_id ASC
  `);

  return result.rows.map((row) => ({
    profileId: row.profile_id,
    workerId: row.worker_id,
    accountId: row.account_id || undefined,
    profilePath: row.profile_path,
    cdpPort: row.cdp_port,
    status: row.status,
    riskCount: row.risk_count,
    lastRiskAt: row.last_risk_at?.toISOString(),
    updatedAt: row.updated_at.toISOString()
  }));
}

export async function getProfile(db: Pool, profileId: string): Promise<ProfileRegistryRow | null> {
  const profiles = await listProfiles(db);
  return profiles.find((profile) => profile.profileId === profileId) || null;
}

export async function updateProfileStatus(
  db: Pool,
  profileId: string,
  update: ProfileStatusUpdate
): Promise<ProfileRegistryRow | null> {
  await db.query(
    `
    UPDATE profiles SET
      status = COALESCE($2, status),
      account_id = CASE WHEN $3::boolean THEN $4 ELSE account_id END,
      last_risk_at = CASE WHEN $5::boolean THEN $6 ELSE last_risk_at END,
      risk_count = CASE WHEN $7::boolean THEN risk_count + 1 ELSE risk_count END,
      updated_at = now()
    WHERE profile_id = $1
    `,
    [
      profileId,
      update.status || null,
      "boundAccountId" in update,
      update.boundAccountId || null,
      "lastRiskAt" in update,
      update.lastRiskAt || null,
      update.status === "profile_risk"
    ]
  );
  return getProfile(db, profileId);
}
