import fs from "node:fs/promises";
import path from "node:path";

export interface LocalSpoolItem<T = unknown> {
  idempotencyKey: string;
  payload: T;
  createdAt?: string;
}

export class LocalSpool<T = unknown> {
  private operation: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  enqueue(item: LocalSpoolItem<T>): Promise<void> {
    return this.exclusive(async () => {
      const items = await this.readAll();
      if (items.some((candidate) => candidate.idempotencyKey === item.idempotencyKey)) return;
      items.push({ ...item, createdAt: item.createdAt || new Date().toISOString() });
      await this.writeAll(items);
    });
  }

  list(): Promise<LocalSpoolItem<T>[]> {
    return this.exclusive(() => this.readAll());
  }

  acknowledge(idempotencyKey: string): Promise<void> {
    return this.exclusive(async () => {
      const items = await this.readAll();
      await this.writeAll(items.filter((item) => item.idempotencyKey !== idempotencyKey));
    });
  }

  private exclusive<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readAll(): Promise<LocalSpoolItem<T>[]> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LocalSpoolItem<T>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeAll(items: LocalSpoolItem<T>[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const content = items.length ? `${items.map((item) => JSON.stringify(item)).join("\n")}\n` : "";
    await fs.writeFile(temporaryPath, content, "utf8");
    await fs.rename(temporaryPath, this.filePath);
  }
}
