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
    await runWindowsTaskKill(pid);
    return;
  }

  signalPosixProcessGroup(pid, "SIGTERM", child);
  const closed = await Promise.race([
    waitForChildClose(child).then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), graceMs))
  ]);
  if (!closed) signalPosixProcessGroup(pid, "SIGKILL", child);
}

function runWindowsTaskKill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    killer.once("close", finish);
    killer.once("error", () => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // The process already exited.
      }
      finish();
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
