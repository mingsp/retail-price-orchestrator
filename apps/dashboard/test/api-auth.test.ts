import assert from "node:assert/strict";
import test from "node:test";

Object.assign(globalThis, {
  window: {
    location: { origin: "https://dashboard.example.test" },
    setTimeout,
    clearTimeout
  }
});

test("dashboard websocket uses only its stable application protocol", async () => {
  const { buildOperatorWebSocketProtocols } = await import("../src/api.js");
  assert.deepEqual(buildOperatorWebSocketProtocols(), ["retail-dashboard-v1"]);
});

test("dashboard requests never expose the internal operator token", async () => {
  let requestHeaders: Headers | undefined;
  Object.assign(globalThis, {
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(new Blob(["image"]), { status: 200, headers: { "Content-Type": "image/png" } });
    }
  });

  const { fetchArtifactContent } = await import("../src/api.js");
  const blob = await fetchArtifactContent("artifact-1");

  assert.equal(requestHeaders?.has("X-Retail-Operator-Token"), false);
  assert.equal(blob.type, "image/png");
});
