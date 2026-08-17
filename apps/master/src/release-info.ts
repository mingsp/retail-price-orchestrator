export const DATABASE_SCHEMA_VERSION = "2026-08-17-p0.1";

export interface ReleaseInfo {
  service: string;
  version: string;
  gitSha: string;
  builtAt: string;
  schemaVersion: string;
}

export function readReleaseInfo(environment: NodeJS.ProcessEnv = process.env): ReleaseInfo {
  return {
    service: "retail-radar-master",
    version: environment.RETAIL_RADAR_VERSION || "0.2.0-dev",
    gitSha: environment.RETAIL_RADAR_GIT_SHA || "unknown",
    builtAt: environment.RETAIL_RADAR_BUILT_AT || "unknown",
    schemaVersion: environment.RETAIL_RADAR_SCHEMA_VERSION || DATABASE_SCHEMA_VERSION
  };
}
