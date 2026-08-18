import { spawn, type ChildProcess } from "node:child_process";

export function collectorProcessGroupOptions(): { detached?: boolean } {
  return process.platform === "win32" ? {} : { detached: true };
}

export function waitForChildClose(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
}

export async function terminateChildProcessTree(child: ChildProcess, graceMs = 5_000): Promise<void> {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === "win32") {
    const taskKillSucceeded = await runWindowsTaskKill(pid, graceMs);
    if (!taskKillSucceeded && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process already exited.
      }
    }
    const closed = await waitForCloseWithin(child, graceMs);
    if (!closed) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // The process already exited.
      }
    }
    if (!(await waitForCloseWithin(child, graceMs))) {
      throw new Error(`child_process_termination_timeout:${pid}`);
    }
    return;
  }

  signalPosixProcessGroup(pid, "SIGTERM", child);
  const closed = await Promise.race([
    waitForChildClose(child).then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), graceMs))
  ]);
  if (!closed) signalPosixProcessGroup(pid, "SIGKILL", child);
}

function waitForCloseWithin(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return Promise.race([
    waitForChildClose(child).then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]);
}

function runWindowsTaskKill(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
    let settled = false;
    const timer = setTimeout(() => {
      try {
        killer.kill("SIGKILL");
      } catch {
        // The helper already exited.
      }
      finish(false);
    }, timeoutMs);
    const finish = (succeeded: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(succeeded);
    };
    killer.once("close", (code) => finish(code === 0));
    killer.once("error", () => {
      finish(false);
    });
  });
}

function signalPosixProcessGroup(pid: number, signal: NodeJS.Signals, child: ChildProcess): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process already exited.
    }
  }
}
