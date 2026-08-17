import fs from "node:fs/promises";
import process from "node:process";

const configPath = process.argv[2];
if (!configPath) throw new Error("usage: node scripts/create-weekly-run-from-baseline.mjs <config.json>");

const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const baseUrl = new URL(config.masterBaseUrl || "http://127.0.0.1:17890");

const existingRuns = await getJson("/api/runs");
let run = existingRuns.runs.find((item) => item.runLabel === config.runLabel);
if (!run) {
  run = (await sendJson("POST", "/api/runs", {
    storeId: config.storeId,
    runLabel: config.runLabel,
    strategy: "category_split",
    targetFinishAt: config.targetFinishAt
  })).run;
}

const current = await getJson(`/api/tasks?runId=${encodeURIComponent(run.runId)}`);
if (current.tasks.length) {
  console.log(JSON.stringify({ runId: run.runId, reused: true, taskCount: current.tasks.length }));
  process.exit(0);
}

const baseline = await getJson(`/api/tasks?runId=${encodeURIComponent(config.baselineRunId)}`);
if (!baseline.tasks.length) throw new Error("baseline_run_has_no_tasks");
if (!Array.isArray(config.assignments) || !config.assignments.length) throw new Error("assignments_required");

const assignmentLoads = config.assignments.map((assignment) => ({ assignment, load: 0, count: 0 }));
const baselineTasks = [...baseline.tasks].sort((a, b) => {
  const aWeight = Math.max(1, a.collectedItems || a.expectedItems || 1);
  const bWeight = Math.max(1, b.collectedItems || b.expectedItems || 1);
  return bWeight - aWeight || a.categoryOrder - b.categoryOrder;
});
const assignedByOrder = new Map();

for (const task of baselineTasks) {
  assignmentLoads.sort((a, b) => a.load - b.load || a.count - b.count || a.assignment.slot - b.assignment.slot);
  const target = assignmentLoads[0];
  const weight = Math.max(1, task.collectedItems || task.expectedItems || 1);
  target.load += weight;
  target.count += 1;
  assignedByOrder.set(task.categoryOrder, target.assignment);
}

const createPayload = [...baseline.tasks]
  .sort((a, b) => a.categoryOrder - b.categoryOrder)
  .map((task) => {
    const assignment = assignedByOrder.get(task.categoryOrder);
    return {
      categoryName: task.categoryName,
      categoryOrder: task.categoryOrder,
      priority: task.categoryOrder * 10,
      expectedItems: task.collectedItems || task.expectedItems || undefined,
      cursor: {
        categoryTag: task.cursor?.categoryTag,
        categoryType: task.cursor?.categoryType,
        categoryI: task.cursor?.categoryI,
        categoryJ: task.cursor?.categoryJ,
        targetUrlPart: config.targetUrlPart,
        baselineRunId: config.baselineRunId,
        baselineCollectedItems: task.collectedItems || 0,
        assignmentStrategy: "static_lpt_by_baseline_items",
        assignmentGuard: "one fixed account owns fixed categories; never duplicate category requests",
        fixedAccountAssignment: true,
        fixedAssignedWorkerId: config.workerId,
        fixedAssignedAccountId: assignment.accountId,
        fixedAssignedProfileId: assignment.profileId,
        fixedAssignedCdpEndpointId: assignment.endpointId,
        assignedSlotIndex: assignment.slot
      }
    };
  });

const created = (await sendJson("POST", `/api/runs/${encodeURIComponent(run.runId)}/tasks`, {
  tasks: createPayload
})).tasks;

for (const task of created) {
  const assignment = assignedByOrder.get(task.categoryOrder);
  await sendJson("PATCH", `/api/tasks/${encodeURIComponent(task.taskId)}`, {
    assignedWorkerId: config.workerId,
    assignedAccountId: assignment.accountId,
    assignedProfileId: assignment.profileId,
    assignedCdpEndpointId: assignment.endpointId,
    cursor: task.cursor
  });
}

console.log(JSON.stringify({
  runId: run.runId,
  reused: false,
  taskCount: created.length,
  assignments: assignmentLoads
    .sort((a, b) => a.assignment.slot - b.assignment.slot)
    .map(({ assignment, load, count }) => ({ slot: assignment.slot, accountId: assignment.accountId, categories: count, baselineItems: load }))
}));

async function getJson(pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  if (!response.ok) throw new Error(`GET ${pathname} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function sendJson(method, pathname, body) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${method} ${pathname} failed: ${response.status} ${await response.text()}`);
  return response.json();
}
