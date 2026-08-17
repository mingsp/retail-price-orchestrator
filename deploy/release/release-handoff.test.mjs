import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../windows/prepare-versioned-source.ps1", import.meta.url), "utf8");

test("source handoff is pinned, verified, and never switches the running deployment", () => {
  assert.match(source, /ExpectedCommit/);
  assert.match(source, /Resolve-RequiredCommand/);
  assert.match(source, /'corepack\.exe', 'corepack\.cmd', 'corepack'/);
  assert.doesNotMatch(source, /corepack\.exe enable/);
  assert.match(source, /rev-list -n 1/);
  assert.match(source, /install --frozen-lockfile/);
  assert.match(source, /pnpm handoff:test/);
  assert.match(source, /pnpm typecheck/);
  assert.match(source, /pnpm public:verify/);
  assert.match(source, /previousDeploymentPreserved = \$true/);
  assert.match(source, /activation = 'not_switched'/);
  assert.doesNotMatch(source, /Remove-Item[^\n]+destination/i);
});
