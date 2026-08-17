import type { WorkerConfig } from "./config.js";
import { executeCdpCommand } from "./cdp-launcher.js";
import { claimCdpCommand, completeCdpCommand } from "./master-api.js";
import { recordCdpCommandResult } from "./cdp-runtime-state.js";

let running = false;

export function startCdpCommandPolling(config: WorkerConfig): void {
  if (!config.cdpCommandPollingEnabled) return;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const command = await claimCdpCommand(config);
      if (!command) return;
      console.log(`[worker] claimed CDP command ${command.commandId} ${command.action}@${command.port}`);
      try {
        const endpoint = await executeCdpCommand(config, command);
        if (endpoint) await recordCdpCommandResult(config, command, endpoint);
        await completeCdpCommand(config, command.commandId, {
          status: "completed",
          claimGeneration: command.claimGeneration,
          endpoint
        });
        console.log(`[worker] completed CDP command ${command.commandId}`);
      } catch (error) {
        await completeCdpCommand(config, command.commandId, {
          status: "failed",
          claimGeneration: command.claimGeneration,
          lastError: error instanceof Error ? error.message : String(error)
        });
        console.error(`[worker] failed CDP command ${command.commandId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      console.error(`[worker] CDP command polling failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };

  tick();
  setInterval(tick, config.cdpCommandPollingIntervalMs);
}
