import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyInstance } from "fastify";
import { isProtectedWorkerRequest, isProtectedWorkerWrite } from "./worker-auth.js";

export function isOperatorRequestAuthorized(presentedToken?: string, configuredToken?: string): boolean {
  if (!configuredToken) return true;
  if (!presentedToken) return false;
  const presented = Buffer.from(presentedToken, "utf8");
  const configured = Buffer.from(configuredToken, "utf8");
  return presented.length === configured.length && timingSafeEqual(presented, configured);
}

export function operatorWriteGuard(configuredToken?: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const value = request.headers["x-retail-operator-token"];
    const presentedToken = Array.isArray(value) ? value[0] : value;
    if (!isOperatorRequestAuthorized(presentedToken, configuredToken)) {
      await reply.code(401).send({ error: "操作台身份校验失败" });
    }
  };
}

export function registerOperatorMutationAuth(app: FastifyInstance, configuredToken?: string): void {
  app.addHook("preHandler", async (request, reply) => {
    if (!requiresOperatorAuth(request)) return;
    await operatorWriteGuard(configuredToken)(request, reply);
  });
}

export function requiresOperatorAuth(request: Pick<FastifyRequest, "method" | "url">): boolean {
  if (!request.url.startsWith("/api/")) return false;
  if (request.method === "POST" && /^\/api\/workers\/enroll(?:\?|$)/.test(request.url)) return false;
  if (/^\/api\/automation\//.test(request.url)) return false;
  if (/^\/api\/registry-sync(?:\/|\?|$)/.test(request.url)) return false;
  if (isProtectedWorkerRequest(request)) return false;
  return true;
}

export function requiresOperatorMutationAuth(request: Pick<FastifyRequest, "method" | "url">): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return false;
  if (request.method === "POST" && /^\/api\/workers\/enroll(?:\?|$)/.test(request.url)) return false;
  if (/^\/api\/automation\//.test(request.url)) return false;
  if (/^\/api\/registry-sync(?:\/|\?|$)/.test(request.url)) return false;
  if (isProtectedWorkerWrite(request)) return false;
  return request.url.startsWith("/api/");
}

export function operatorTokenFromWebSocketProtocols(header?: string): string | undefined {
  const encoded = header
    ?.split(",")
    .map((value) => value.trim())
    .find((value) => value.startsWith("retail-operator."))
    ?.slice("retail-operator.".length);
  if (!encoded) return undefined;
  try {
    return Buffer.from(encoded, "base64url").toString("utf8") || undefined;
  } catch {
    return undefined;
  }
}

export function operatorTokenFromHeader(value?: string | string[]): string | undefined {
  const token = Array.isArray(value) ? value[0] : value;
  return token?.trim() || undefined;
}

export function isCorsOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}
