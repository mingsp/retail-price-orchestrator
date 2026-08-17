import { spawn } from "node:child_process";

const [workspace, command, ...rest] = process.argv.slice(2);
if (!workspace || !command) {
  console.error("usage: node scripts/run-workspace.mjs <workspace> <command> [...args]");
  process.exit(2);
}

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  console.error("npm_execpath is unavailable; run this command through pnpm.");
  process.exit(2);
}

const child = spawn(process.execPath, [npmExecPath, "--dir", workspace, command, ...rest], {
  stdio: "inherit",
  env: process.env
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
