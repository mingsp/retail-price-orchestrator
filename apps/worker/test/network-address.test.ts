import assert from "node:assert/strict";
import test from "node:test";
import { selectWorkerIp } from "../src/config.js";

test("worker IP selection supports any private LAN instead of a fixed subnet", () => {
  assert.equal(selectWorkerIp([
    { family: "IPv4", internal: true, address: "127.0.0.1" },
    { family: "IPv4", internal: false, address: "203.0.113.9" },
    { family: "IPv4", internal: false, address: "10.20.30.40" }
  ]), "10.20.30.40");
});

test("worker IP selection falls back to a public external IPv4", () => {
  assert.equal(selectWorkerIp([
    { family: "IPv6", internal: false, address: "2001:db8::1" },
    { family: "IPv4", internal: false, address: "203.0.113.9" }
  ]), "203.0.113.9");
});
