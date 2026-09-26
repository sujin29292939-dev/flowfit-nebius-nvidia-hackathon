import { isDatabaseConfigured, sql } from "../db/client.js";
import { DEFAULT_COMPANY_ID } from "../intake/config.js";

export async function getOperationsMetrics(input: {
  companyId?: string;
  windowDays?: number;
} = {}) {
  if (!isDatabaseConfigured()) {
    return {
      skipped: true,
      reason: "DATABASE_URL is not configured.",
      companyId: input.companyId ?? DEFAULT_COMPANY_ID,
    };
  }

  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  const windowDays = Math.min(Math.max(input.windowDays ?? 7, 1), 90);

  const [
    taskRows,
    intakeRows,
    approvalRows,
    autoSendRows,
    connectorFailureRows,
    dueRows,
  ] = await Promise.all([
    sql`
      SELECT status, task_type, COUNT(*)::int AS count
      FROM tasks
      WHERE company_id = ${companyId}
        AND created_at >= NOW() - make_interval(days => ${windowDays})
      GROUP BY status, task_type
    `,
    sql`
      SELECT source_type, COUNT(*)::int AS count
      FROM intakes
      WHERE company_id = ${companyId}
        AND created_at >= NOW() - make_interval(days => ${windowDays})
      GROUP BY source_type
    `,
    sql`
      SELECT status, COUNT(*)::int AS count
      FROM approval_requests
      WHERE company_id = ${companyId}
        AND created_at >= NOW() - make_interval(days => ${windowDays})
      GROUP BY status
    `,
    sql`
      SELECT action, COUNT(*)::int AS count
      FROM audit_logs
      WHERE company_id = ${companyId}
        AND created_at >= NOW() - make_interval(days => ${windowDays})
        AND action IN ('autonomy_gate_auto_send', 'approval_required_created', 'task_decision_made')
      GROUP BY action
    `,
    sql`
      SELECT t.status, COUNT(*)::int AS count
      FROM tasks t
      WHERE t.company_id = ${companyId}
        AND t.status IN ('retry_pending', 'failed', 'connector_reauth_required', 'waiting_connector')
      GROUP BY t.status
    `,
    sql`
      SELECT
        COUNT(*) FILTER (
          WHERE due_at IS NOT NULL
            AND due_at <= NOW() + INTERVAL '24 hours'
            AND status NOT IN ('completed', 'blocked', 'failed', 'approval_rejected')
        )::int AS due_soon,
        COUNT(*) FILTER (
          WHERE due_at IS NOT NULL
            AND due_at < NOW()
            AND status NOT IN ('completed', 'blocked', 'failed', 'approval_rejected')
        )::int AS overdue
      FROM tasks
      WHERE company_id = ${companyId}
    `,
  ]);

  const tasksByStatus = countMap(taskRows, "status");
  const totalTasks = sumValues(tasksByStatus);
  const completedTasks = (tasksByStatus.completed ?? 0) + (tasksByStatus.auto_completed ?? 0);
  const approvalCreated = getAuditCount(autoSendRows, "approval_required_created");
  const autoSent = getAuditCount(autoSendRows, "autonomy_gate_auto_send");

  return {
    companyId,
    windowDays,
    generatedAt: new Date().toISOString(),
    automation: {
      totalTasks,
      completedTasks,
      automationRate: ratio(completedTasks, totalTasks),
      autoSendCount: autoSent,
      approvalCreatedCount: approvalCreated,
      autoSendRatio: ratio(autoSent, autoSent + approvalCreated),
    },
    tasks: {
      byStatus: tasksByStatus,
      byType: countMap(taskRows, "task_type"),
      pendingApproval: (tasksByStatus.approval_required ?? 0) + (tasksByStatus.waiting_approval ?? 0),
      inProgress: (tasksByStatus.connector_executing ?? 0) + (tasksByStatus.ready_to_execute ?? 0),
    },
    intakes: {
      bySource: countMap(intakeRows, "source_type"),
    },
    approvals: {
      byStatus: countMap(approvalRows, "status"),
    },
    connectors: {
      byFailureStatus: countMap(connectorFailureRows, "status"),
      retryPending: countMap(connectorFailureRows, "status").retry_pending ?? 0,
      reauthRequired: countMap(connectorFailureRows, "status").connector_reauth_required ?? 0,
    },
    sla: {
      dueSoon: Number(dueRows[0]?.due_soon ?? 0),
      overdue: Number(dueRows[0]?.overdue ?? 0),
    },
  };
}

function countMap(rows: Array<Record<string, unknown>>, key: string) {
  return Object.fromEntries(
    rows.map((row) => [String(row[key] ?? "unknown"), Number(row.count ?? 0)]),
  ) as Record<string, number>;
}

function getAuditCount(rows: Array<Record<string, unknown>>, action: string) {
  return rows.find((row) => row.action === action)?.count ? Number(rows.find((row) => row.action === action)?.count) : 0;
}

function sumValues(value: Record<string, number>) {
  return Object.values(value).reduce((sum, count) => sum + count, 0);
}

function ratio(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}
