import assert from "node:assert/strict";
import test from "node:test";
import {
  isCorsOriginAllowed,
  isOperatorRequestAuthorized,
  operatorTokenFromHeader,
  operatorTokenFromWebSocketProtocols,
  requiresOperatorAuth,
  requiresOperatorMutationAuth
} from "../src/operator-auth.js";

test("operator writes require the configured server-side token", () => {
  assert.equal(isOperatorRequestAuthorized("secret-a", "secret-a"), true);
  assert.equal(isOperatorRequestAuthorized("secret-b", "secret-a"), false);
  assert.equal(isOperatorRequestAuthorized(undefined, "secret-a"), false);
});

test("all operator mutations are protected while worker and enrollment writes keep their own credentials", () => {
  assert.equal(requiresOperatorMutationAuth({ method: "POST", url: "/api/stores" } as any), true);
  assert.equal(requiresOperatorMutationAuth({ method: "PATCH", url: "/api/tasks/task-1" } as any), true);
  assert.equal(requiresOperatorMutationAuth({ method: "POST", url: "/api/tasks/claim" } as any), false);
  assert.equal(requiresOperatorMutationAuth({ method: "POST", url: "/api/product-snapshots/batch" } as any), false);
  assert.equal(requiresOperatorMutationAuth({ method: "POST", url: "/api/workers/enroll" } as any), false);
  assert.equal(requiresOperatorMutationAuth({ method: "POST", url: "/api/automation/supervisor" } as any), false);
  assert.equal(requiresOperatorMutationAuth({ method: "POST", url: "/api/registry-sync/publish" } as any), false);
  assert.equal(requiresOperatorMutationAuth({ method: "GET", url: "/api/stores" } as any), false);
});

test("operator guard remains disabled for local development without a configured token", () => {
  assert.equal(isOperatorRequestAuthorized(undefined, undefined), true);
});

test("operator reads are protected without taking over worker, automation or enrollment authentication", () => {
  assert.equal(requiresOperatorAuth({ method: "GET", url: "/api/artifacts" } as any), true);
  assert.equal(requiresOperatorAuth({ method: "GET", url: "/api/artifacts/artifact-1/content" } as any), true);
  assert.equal(requiresOperatorAuth({ method: "GET", url: "/api/deliveries/run-1/download" } as any), true);
  assert.equal(requiresOperatorAuth({ method: "POST", url: "/api/tasks/claim" } as any), false);
  assert.equal(requiresOperatorAuth({ method: "POST", url: "/api/workers/enroll" } as any), false);
  assert.equal(requiresOperatorAuth({ method: "GET", url: "/api/automation/v1/audit" } as any), false);
  assert.equal(requiresOperatorAuth({ method: "GET", url: "/api/worker/self" } as any), false);
  assert.equal(requiresOperatorAuth({ method: "GET", url: "/api/registry-sync/status" } as any), false);
});

test("dashboard websocket token is decoded from a protocol header instead of the URL", () => {
  const encoded = Buffer.from("operator-secret", "utf8").toString("base64url");
  assert.equal(
    operatorTokenFromWebSocketProtocols(`retail-dashboard-v1, retail-operator.${encoded}`),
    "operator-secret"
  );
  assert.equal(operatorTokenFromWebSocketProtocols("retail-dashboard-v1"), undefined);
});

test("dashboard websocket accepts the token injected by the trusted reverse proxy", () => {
  assert.equal(operatorTokenFromHeader("operator-secret"), "operator-secret");
  assert.equal(operatorTokenFromHeader(["operator-secret", "ignored"]), "operator-secret");
  assert.equal(operatorTokenFromHeader("  "), undefined);
});

test("CORS accepts only configured origins and non-browser requests", () => {
  const allowed = ["https://dashboard.example.test", "http://127.0.0.1:2808"];
  assert.equal(isCorsOriginAllowed(undefined, allowed), true);
  assert.equal(isCorsOriginAllowed("https://dashboard.example.test", allowed), true);
  assert.equal(isCorsOriginAllowed("https://attacker.example.test", allowed), false);
});
