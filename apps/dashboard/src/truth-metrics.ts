import type { AccountSnapshot, CategoryTaskRecord } from "@retail-orchestrator/shared";

const activeTaskStatuses = new Set(["assigned", "running", "collecting", "captured", "uploading", "structuring", "validating"]);

type ProgressTask = Pick<CategoryTaskRecord, "status" | "collectedItems" | "expectedItems" | "cursor">;

export function accountHealthPercent(accounts: AccountSnapshot[]): number | undefined {
  if (!accounts.length) return undefined;
  const healthy = accounts.filter(
    (account) => account.status === "safe" && account.riskLevel === "normal" && account.profileStatus === "safe"
  ).length;
  return Math.round((healthy / accounts.length) * 100);
}

export function buildTruthfulRunProgress(tasks: ProgressTask[]) {
  const totalCategories = tasks.length;
  const validatedCategories = tasks.filter((task) => task.status === "completed_valid").length;
  const excludedCategories = tasks.filter(
    (task) => task.status === "skipped" && task.cursor?.exclusionEvidence === true
  ).length;
  const resolvedCategories = validatedCategories + excludedCategories;
  const productTasks = tasks.filter(
    (task) => !(task.status === "skipped" && task.cursor?.exclusionEvidence === true)
  );
  const expectedItemsKnown = productTasks.length > 0 && productTasks.every(
    (task) => typeof task.expectedItems === "number" && task.expectedItems > 0
  );
  const expectedItems = expectedItemsKnown
    ? productTasks.reduce((sum, task) => sum + (task.expectedItems || 0), 0)
    : undefined;
  const collectedItems = tasks.reduce((sum, task) => sum + Math.max(0, task.collectedItems || 0), 0);
  const rawItemPercent = expectedItems ? Math.min(100, Math.floor((collectedItems / expectedItems) * 100)) : undefined;
  const allResolved = totalCategories > 0 && resolvedCategories === totalCategories;
  const itemProgressPercent = rawItemPercent === 100 && !allResolved ? undefined : rawItemPercent;
  const hasLegacyFinished = tasks.some((task) => task.status === "completed");

  return {
    totalCategories,
    validatedCategories,
    excludedCategories,
    resolvedCategories,
    categoryCompletionPercent: totalCategories ? Math.floor((resolvedCategories / totalCategories) * 100) : 0,
    expectedItemsKnown,
    expectedItems,
    collectedItems,
    itemProgressPercent,
    itemProgressLabel: expectedItemsKnown
      ? itemProgressPercent === undefined
        ? "商品总量待确认"
        : `已知商品进度 ${itemProgressPercent}%`
      : hasLegacyFinished
        ? "商品总量待确认"
        : "商品总量待识别"
  };
}

export type OperationalAccount<T extends AccountSnapshot = AccountSnapshot> = T & {
  lastCollectedAt?: string;
  operationalSource: "active_task" | "registry";
};

export function reconcileAccountOperationalTruth<T extends AccountSnapshot>(
  account: T,
  tasks: CategoryTaskRecord[]
): OperationalAccount<T> {
  const ownedTasks = tasks.filter((task) => task.assignedAccountId === account.accountId);
  const activeTask = ownedTasks
    .filter((task) => activeTaskStatuses.has(task.status))
    .sort((left, right) => eventTime(right) - eventTime(left))[0];
  const taskLastCollectedAt = ownedTasks
    .filter((task) => task.collectedItems > 0)
    .map((task) => task.lastProgressAt || task.updatedAt)
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
  const lastCollectedAt = [taskLastCollectedAt, account.lastCollectedAt]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

  return {
    ...account,
    currentStoreId: activeTask?.storeId || account.currentStoreId,
    currentStoreName: activeTask?.storeName || account.currentStoreName,
    currentCategoryName: activeTask?.categoryName,
    lastCollectedAt,
    operationalSource: activeTask ? "active_task" : "registry"
  };
}

export function formatElapsedSince(value?: string, now = new Date()): string {
  if (!value) return "暂无采集记录";
  const elapsed = Math.max(0, now.getTime() - new Date(value).getTime());
  if (!Number.isFinite(elapsed)) return "时间未知";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "刚刚采集";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function eventTime(task: CategoryTaskRecord): number {
  return new Date(task.lastProgressAt || task.updatedAt || task.createdAt).getTime();
}
