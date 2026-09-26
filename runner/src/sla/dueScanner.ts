import { isDatabaseConfigured, sql } from "../db/client.js";

export interface SlaScanResult {
  skipped?: boolean;
  dueSoonCount: number;
  approvalReminderCount: number;
}

export async function scanDueTasks(input: {
  horizonMinutes?: number;
  approvalReminderMinutes?: number;
  limit?: number;
} = {}): Promise<SlaScanResult> {
  if (!isDatabaseConfigured()) {
    return { skipped: true, dueSoonCount: 0, approvalReminderCount: 0 };
  }

  const horizonMinutes = Math.max(1, input.horizonMinutes ?? Number(process.env.SLA_DUE_HORIZON_MINUTES ?? 120));
  const approvalReminderMinutes = Math.max(1, input.approvalReminderMinutes ?? Number(process.env.APPROVAL_REMINDER_MINUTES ?? 60));
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  const dueSoon = await sql`
    SELECT t.id, t.company_id, t.task_type, t.status, t.due_at, t.extracted_fields_json
    FROM tasks t
    WHERE t.due_at IS NOT NULL
      AND t.due_at <= NOW() + make_interval(mins => ${horizonMinutes})
      AND t.status NOT IN ('completed', 'blocked', 'failed', 'approval_rejected')
      AND NOT EXISTS (
        SELECT 1
        FROM audit_logs al
        WHERE al.target_type = 'task'
          AND al.target_id = t.id
          AND al.action = 'task_due_soon'
          AND al.created_at > NOW() - INTERVAL '6 hours'
      )
    ORDER BY t.due_at ASC
    LIMIT ${limit}
  `;

  for (const task of dueSoon) {
    await sql`
      INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
      VALUES (
        ${String(task.company_id)},
        'system',
        'task_due_soon',
        'task',
        ${String(task.id)},
        ${JSON.stringify({
          taskType: task.task_type,
          status: task.status,
          dueAt: task.due_at,
          horizonMinutes,
        })}
      )
    `;
  }

  const approvals = await sql`
    SELECT ar.id, ar.company_id, ar.task_id, ar.title, ar.created_at
    FROM approval_requests ar
    WHERE ar.status = 'pending'
      AND ar.created_at <= NOW() - make_interval(mins => ${approvalReminderMinutes})
      AND NOT EXISTS (
        SELECT 1
        FROM audit_logs al
        WHERE al.target_type = 'approval_request'
          AND al.target_id = ar.id
          AND al.action = 'approval_reminder_due'
          AND al.created_at > NOW() - INTERVAL '6 hours'
      )
    ORDER BY ar.created_at ASC
    LIMIT ${limit}
  `;

  for (const approval of approvals) {
    await sql`
      INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
      VALUES (
        ${String(approval.company_id)},
        'system',
        'approval_reminder_due',
        'approval_request',
        ${String(approval.id)},
        ${JSON.stringify({
          taskId: approval.task_id,
          title: approval.title,
          createdAt: approval.created_at,
          approvalReminderMinutes,
        })}
      )
    `;
  }

  return {
    dueSoonCount: dueSoon.length,
    approvalReminderCount: approvals.length,
  };
}

export function startDueScanner() {
  if (process.env.SLA_SCANNER_ENABLED === "false") return () => undefined;
  const intervalMs = Math.max(10_000, Number(process.env.SLA_SCANNER_INTERVAL_MS ?? 60_000));

  const timer = setInterval(() => {
    scanDueTasks().catch((error) => {
      console.error(`[SLA] scan failed: ${String(error)}`);
    });
  }, intervalMs);

  timer.unref?.();
  return () => clearInterval(timer);
}
