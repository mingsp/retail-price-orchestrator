import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { hashSecret, secretMatchesHash } from "./repositories/worker-enrollment.js";
import { findActiveWorkerByTokenHash } from "./repositories/worker-enrollment.js";

export interface WorkerAuthentication {
  workerId?: string;
  legacy: boolean;
}

export interface WorkerBearerAuthenticationOptions {
  allowLegacySharedToken: boolean;
  legacySharedToken: string;
  findWorkerByTokenHash: (tokenHash: string) => Promise<string | undefined>;
}

export async function authenticateWorkerBearer(
  bearerToken: string | undefined,
  options: WorkerBearerAuthenticationOptions
): Promise<WorkerAuthentication | undefined> {
  if (!bearerToken) return undefined;
  const workerId = await options.findWorkerByTokenHash(hashSecret(bearerToken));
  if (workerId) return { workerId, legacy: false };
  if (isLegacyWorkerTokenAllowed(
    bearerToken,
    options.legacySharedToken,
    options.allowLegacySharedToken
  )) return { legacy: true };
  return undefined;
}

export function isLegacyWorkerTokenAllowed(
  bearerToken: string,
  configuredToken: string,
  enabled: boolean
): boolean {
  return enabled
    && Boolean(configuredToken)
    && configuredToken !== "change-me"
    && secretMatchesHash(bearerToken, hashSecret(configuredToken));
}

export function assertWorkerIdentity(auth: WorkerAuthentication, claimedWorkerId: string): void {
  if (!auth.legacy && auth.workerId !== claimedWorkerId) throw new Error("worker_identity_mismatch");
}

const protectedWorkerWrites = [
  { method: "POST", pattern: /^\/api\/tasks\/claim(?:\?|$)/ },
  { method: "PATCH", pattern: /^\/api\/worker\/tasks\/[^/?]+(?:\?|$)/ },
  { method: "POST", pattern: /^\/api\/worker\/tasks\/[^/]+\/lease\/renew(?:\?|$)/ },
  { method: "POST", pattern: /^\/api\/cdp-commands\/claim(?:\?|$)/ },
  { method: "POST", pattern: /^\/api\/cdp-commands\/[^/]+\/complete(?:\?|$)/ },
  { method: "POST", pattern: /^\/api\/product-snapshots\/batch(?:\?|$)/ },
  { method: "POST", pattern: /^\/api\/artifacts(?:\?|$)/ },
  { method: "POST", pattern: /^\/api\/artifacts\/presign(?:\?|$)/ },
  { method: "POST", pattern: /^\/api\/quality-checks(?:\?|$)/ },
  { method: "POST", pattern: /^\/api\/ingestion-errors(?:\?|$)/ },
  { method: "POST", pattern: /^\/api\/risk-events(?:\?|$)/ }
];

const protectedWorkerReads = [
  { method: "GET", pattern: /^\/api\/worker\/self(?:\?|$)/ }
];

export interface RegisterWorkerHttpAuthOptions {
  db: Pool;
  workerSharedToken: string;
  allowLegacyWorkerSharedToken: boolean;
}

const authenticationByRequest = new WeakMap<FastifyRequest, WorkerAuthentication>();

export function getWorkerAuthentication(request: FastifyRequest): WorkerAuthentication | undefined {
  return authenticationByRequest.get(request);
}

export function registerWorkerHttpAuth(app: FastifyInstance, options: RegisterWorkerHttpAuthOptions): void {

  app.addHook("preHandler", async (request, reply) => {
    if (!isProtectedWorkerRequest(request)) return;
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    const authentication = await authenticateWorkerBearer(token, {
      allowLegacySharedToken: options.allowLegacyWorkerSharedToken,
      legacySharedToken: options.workerSharedToken,
      findWorkerByTokenHash: (tokenHash) => findActiveWorkerByTokenHash(options.db, tokenHash)
    });
    if (!authentication) return reply.code(401).send({ error: "unauthorized_worker_request" });
    try {
      for (const workerId of claimedWorkerIds(request)) assertWorkerIdentity(authentication, workerId);
    } catch {
      return reply.code(403).send({ error: "worker_identity_mismatch" });
    }
    authenticationByRequest.set(request, authentication);
  });
}

export function isProtectedWorkerWrite(request: Pick<FastifyRequest, "method" | "url">): boolean {
  return protectedWorkerWrites.some((rule) => request.method === rule.method && rule.pattern.test(request.url));
}

export function isProtectedWorkerRequest(request: Pick<FastifyRequest, "method" | "url">): boolean {
  return isProtectedWorkerWrite(request)
    || protectedWorkerReads.some((rule) => request.method === rule.method && rule.pattern.test(request.url));
}

function claimedWorkerIds(request: FastifyRequest): string[] {
  const body = request.body as Record<string, unknown> | undefined;
  if (!body) return [];
  const ids = new Set<string>();
  addWorkerId(ids, body.workerId);
  addWorkerId(ids, body.writeWorkerId);
  addWorkerId(ids, body.expectedLeaseOwner);
  if (!body.writeWorkerId) {
    collectNestedWorkerIds(ids, body.products);
    collectNestedWorkerIds(ids, body.skus);
  }
  return [...ids];
}

function collectNestedWorkerIds(ids: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (entry && typeof entry === "object") addWorkerId(ids, (entry as Record<string, unknown>).workerId);
  }
}

function addWorkerId(ids: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.trim()) ids.add(value.trim());
}
