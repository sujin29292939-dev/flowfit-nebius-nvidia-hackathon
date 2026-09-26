// context/runner.ts
// Task Context Engine 실행 진입점.

import { matchCompanyContext } from "./engine.js";
import {
  getTaskForContext,
  listPendingContextTasks,
  loadCompanyContextCatalog,
  markTaskContextFailed,
  saveTaskContext,
  taskRowToContextInput,
} from "./store.js";
import type { CompanyContextCatalog, TaskForContext } from "./types.js";

export async function matchAndStoreTaskContext(taskId: string) {
  const task = await getTaskForContext(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  try {
    const catalog = await loadCompanyContextCatalog(task.companyId);
    const context = matchCompanyContext({ task, catalog });
    const saved = await saveTaskContext(task.id, context);
    return { task, context, saved };
  } catch (error) {
    await markTaskContextFailed(taskId, String(error)).catch(() => {});
    throw error;
  }
}

export async function matchRawTaskContext(task: TaskForContext, catalog: CompanyContextCatalog) {
  return matchCompanyContext({ task, catalog });
}

export async function matchPendingTaskContexts(input: { companyId?: string; limit?: number }) {
  const rows = await listPendingContextTasks(input);
  const results: Array<{ taskId: string; ok: boolean; status?: string; error?: string }> = [];

  for (const row of rows) {
    const task = taskRowToContextInput(row);
    try {
      const catalog = await loadCompanyContextCatalog(task.companyId);
      const context = matchCompanyContext({ task, catalog });
      await saveTaskContext(task.id, context);
      results.push({ taskId: task.id, ok: true, status: context.status });
    } catch (error) {
      await markTaskContextFailed(task.id, String(error)).catch(() => {});
      results.push({ taskId: task.id, ok: false, error: String(error) });
    }
  }

  return { count: results.length, results };
}

export function shouldAutoMatchTaskContext() {
  return process.env.AUTO_MATCH_TASK_CONTEXT !== "false";
}

export function scheduleContextMatch(taskId: string) {
  if (!shouldAutoMatchTaskContext()) return;
  setTimeout(() => {
    matchAndStoreTaskContext(taskId).catch((error) => {
      console.error(`[Context] failed for ${taskId}: ${String(error)}`);
    });
  }, 0);
}
