import { isDatabaseConfigured, sql } from "../db/client.js";

export interface TaskTimelineItem {
  id: string;
  source: "task" | "intake" | "approval" | "tool_run" | "audit";
  type: string;
  at: string;
  title: string;
  data: Record<string, unknown>;
}

export async function getTaskTimeline(taskId: string) {
  if (!isDatabaseConfigured()) {
    throw new Error("Task timeline requires DATABASE_URL.");
  }

  const taskRows = await sql`
    SELECT id, company_id, intake_id, task_type, status, extracted_fields_json, context_json, context_status, risk_level, confidence, due_at, created_at, updated_at
    FROM tasks
    WHERE id = ${taskId}
    LIMIT 1
  `;
  if (taskRows.length === 0) throw new Error(`Task not found: ${taskId}`);

  const task = taskRows[0];
  const [intakeRows, approvalRows, toolRows, auditRows] = await Promise.all([
    task.intake_id
      ? sql`
          SELECT id, source_type, source_name, raw_text, status, received_at, created_at, created_at AS updated_at
          FROM intakes
          WHERE id = ${String(task.intake_id)}
          LIMIT 1
        `
      : Promise.resolve([]),
    sql`
      SELECT id, title, description, status, selected_option, resolved_by, created_at, resolved_at, options_json
      FROM approval_requests
      WHERE task_id = ${taskId}
      ORDER BY created_at ASC
    `,
    sql`
      SELECT id, tool_name, status, input_json, output_json, error_json, started_at, finished_at
      FROM tool_runs
      WHERE task_id = ${taskId}
      ORDER BY started_at ASC
    `,
    sql`
      SELECT id, actor_type, actor_id, action, target_type, target_id, metadata_json, created_at
      FROM audit_logs
      WHERE target_id = ${taskId}
         OR metadata_json->>'taskId' = ${taskId}
      ORDER BY created_at ASC
      LIMIT 200
    `,
  ]);

  const items: TaskTimelineItem[] = [
    {
      id: `${taskId}:created`,
      source: "task",
      type: "task_created",
      at: toIso(task.created_at),
      title: "업무 생성",
      data: rowData(task),
    },
    ...intakeRows.map((row: Record<string, unknown>) => ({
      id: `${String(row.id)}:intake`,
      source: "intake" as const,
      type: "intake_received",
      at: toIso(row.received_at ?? row.created_at),
      title: `원본 접수: ${String(row.source_type ?? "unknown")}`,
      data: rowData(row),
    })),
    ...approvalRows.map((row: Record<string, unknown>) => ({
      id: `${String(row.id)}:approval`,
      source: "approval" as const,
      type: `approval_${String(row.status)}`,
      at: toIso(row.resolved_at ?? row.created_at),
      title: String(row.title ?? "승인 요청"),
      data: rowData(row),
    })),
    ...toolRows.map((row: Record<string, unknown>) => ({
      id: `${String(row.id)}:tool`,
      source: "tool_run" as const,
      type: `tool_${String(row.status)}`,
      at: toIso(row.finished_at ?? row.started_at),
      title: `도구 실행: ${String(row.tool_name)}`,
      data: rowData(row),
    })),
    ...auditRows.map((row: Record<string, unknown>) => ({
      id: `${String(row.id)}:audit`,
      source: "audit" as const,
      type: String(row.action),
      at: toIso(row.created_at),
      title: String(row.action),
      data: rowData(row),
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return { taskId, task: rowData(task), count: items.length, items };
}

function rowData(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

function toIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const time = Date.parse(String(value));
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return new Date().toISOString();
}
