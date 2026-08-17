export interface DependencyCheck {
  name: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export class DependencyTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "DependencyTimeoutError";
  }
}

export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DependencyTimeoutError(label, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkDependency(
  name: string,
  operation: () => Promise<unknown>,
  timeoutMs = 3_000
): Promise<DependencyCheck> {
  const startedAt = Date.now();
  try {
    await withTimeout(operation(), timeoutMs, name);
    return { name, ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function runBestEffort(
  label: string,
  operation: () => Promise<unknown>,
  onFailure: (error: unknown) => void,
  timeoutMs = 2_000
): Promise<boolean> {
  try {
    await withTimeout(operation(), timeoutMs, label);
    return true;
  } catch (error) {
    onFailure(error);
    return false;
  }
}
