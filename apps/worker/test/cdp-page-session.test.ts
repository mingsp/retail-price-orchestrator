import assert from "node:assert/strict";
import test from "node:test";
import { connectToCdpPage } from "../../../scripts/lib/cdp-page-session.mjs";

class FakeWebSocket extends EventTarget {
  static instance: FakeWebSocket | undefined;
  readonly sent: string[] = [];
  closed = false;

  constructor(_url: string) {
    super();
    FakeWebSocket.instance = this;
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }
}

test("connectToCdpPage closes the websocket when Runtime.enable times out", async () => {
  const fetchImpl = async () => new Response(JSON.stringify([
    {
      type: "page",
      url: "https://cactivityapi-sc.waimai.meituan.com/store",
      webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/1"
    }
  ]));

  await assert.rejects(
    connectToCdpPage({
      cdpEndpoint: "http://127.0.0.1:9301",
      targetUrlPart: "cactivityapi-sc.waimai.meituan.com",
      fetchImpl,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      commandTimeoutMs: 5
    }),
    /timeout Runtime\.enable/
  );

  assert.equal(FakeWebSocket.instance?.closed, true);
});
