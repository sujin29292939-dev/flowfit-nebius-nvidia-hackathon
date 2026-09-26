import { isDatabaseConfigured, sql } from "../db/client.js";
import { runTaskViaConnectors } from "./runtime.js";

export interface ConnectorRetryResult {
  skipped?: boolean;
  retried: number;
  deadLettered: number;
  results: Array<{ taskId: string; ok: boolean; error?: string }>;
}

export async function retryPendingConnectorTasks(input: {
  limit?: number;
  maxAttempts?: number;
} = {}): Promise<ConnectorRetryResult> {
  if (!isDatabaseConfigured()) {
    return { skipped: true, retried: 0, deadLettered: 0, results: [] };
  }

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const maxAttempts = Math.max(1, input.maxAttempts ?? Number(process.env.CONNECTOR_RETRY_MAX_ATTEMPTS ?? 3));

  const rows = await sql`
    SELECT
      t.id,
      t.company_id,
      COALESCE((last.metadata_json->'failurePolicy'->>'suggestedDelayMs')::int, 15000) AS suggested_delay_ms,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - last.created_at)) * 1000, 999999999) AS elapsed_ms,
      (
        SELECT COUNT(*)
        FROM audit_logs retry_log
        WHERE retry_log.target_type = 'task'
          AND retry_log.target_id = t.id
          AND retry_log.action = 'connector_execution_state_changed'
          AND retry_log.metadata_json->'failurePolicy'->>'status' = 'retry_pending'
      ) AS retry_count
    FROM tasks t
    LEFT JOIN LATERAL (
      SELECT metadata_json, created_at
      FROM audit_logs al
      WHERE al.target_type = 'task'
        AND al.target_id = t.id
        AND al.action = 'connector_execution_state_changed'
      ORDER BY al.created_at DESC
      LIMIT 1
    ) last ON true
    WHERE t.status = 'retry_pending'
    ORDER BY t.updated_at ASC
    LIMIT ${limit}
  `;

  const results: ConnectorRetryResult["results"] = [];
  let retried = 0;
  let deadLettered = 0;

  for (const row of rows) {
    const taskId = String(row.id);
    const retryCount = Number(row.retry_count ?? 0);
    const suggestedDelayMs = Number(row.suggested_delay_ms ?? 15_000);
    const elapsedMs = Number(row.elapsed_ms ?? 0);

    if (elapsedMs < suggestedDelayMs) continue;

    if (retryCount >= maxAttempts) {
      await markRetryDeadLetter(taskId, String(row.company_id), retryCount, maxAttempts);
      deadLettered += 1;
      results.push({ taskId, ok: false, error: "retry attempts exceeded" });
      continue;
    }

    try {
      await runTaskViaConnectors(taskId);
      retried += 1;
      results.push({ taskId, ok: true });
    } catch (error) {
      results.push({ taskId, ok: false, error: String(error) });
    }
  }

  return { retried, deadLettered, results };
}

export function startConnectorRetryWorker() {
  if (process.env.CONNECTOR_RETRY_WORKER_ENABLED === "false") return () => undefined;
  const intervalMs = Math.max(10_000, Number(process.env.CONNECTOR_RETRY_INTERVAL_MS ?? 30_000));

  const timer = setInterval(() => {
    retryPendingConnectorTasks().catch((error) => {
      console.error(`[ConnectorRetry] failed: ${String(error)}`);
    });
  }, intervalMs);

  timer.unref?.();
  return () => clearInterval(timer);
}

async function markRetryDeadLetter(taskId: string, companyId: string, retryCount: number, maxAttempts: number) {
  await sql`
    UPDATE tasks
    SET status = 'failed', updated_at = NOW()
    WHERE id = ${taskId}
  `;
  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    VALUES (
      ${companyId},
      'system',
      'connector_retry_dead_lettered',
      'task',
      ${taskId},
      ${JSON.stringify({ retryCount, maxAttempts })}
    )
  `;
}
