import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import readline from "node:readline";

export interface ReplayProgressFileOptions {
  seenLines?: ReadonlySet<string>;
  onLine: (line: string) => Promise<void> | void;
}

export interface ReplayProgressFileResult {
  replayed: number;
  skipped: number;
}

export async function replayProgressFile(
  progressFile: string,
  options: ReplayProgressFileOptions
): Promise<ReplayProgressFileResult> {
  if (!(await exists(progressFile))) return { replayed: 0, skipped: 0 };

  const stream = createReadStream(progressFile, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let replayed = 0;
  let skipped = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (options.seenLines?.has(trimmed)) {
      skipped += 1;
      continue;
    }
    await options.onLine(trimmed);
    replayed += 1;
  }

  return { replayed, skipped };
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
