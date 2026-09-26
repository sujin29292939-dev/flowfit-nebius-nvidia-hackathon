// understanding/taskStore.ts
// Understanding 결과를 tasks 테이블에 저장한다.

import { randomUUID } from "node:crypto";
import { isDatabaseConfigured, sql } from "../db/client.js";
import { DEFAULT_COMPANY_ID } from "../intake/config.js";
import { getMemoryIntakeForUnderstanding, listIntakes, setMemoryIntakeStatus } from "../intake/store.js";
import type { TaskUnderstandingResult, UnderstandingInput } from "./types.js";

const memoryTasks = new Map<string, Record<string, unknown>>();

export async function getIntakeForUnderstanding(intakeId: string): Promise<UnderstandingInput | null> {
  if (!isDatabaseConfigured()) {
    const intake = getMemoryIntakeForUnderstanding(intakeId);
    if (!intake) return null;
    return {
      intakeId: intake.id,
      companyId: intake.companyId,
      sourceType: intake.sourceType,
      sourceName: intake.sourceName,
      rawText: intake.rawText ?? "",
      receivedAt: intake.receivedAt,
    };
  }

  const rows = await sql`
    SELECT id, company_id, source_type, source_name, raw_text, received_at
    FROM intakes
    WHERE id = ${intakeId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    intakeId: String(row.id),
    companyId: String(row.company_id),
    sourceType: String(row.source_type),
    sourceName: row.source_name ? String(row.source_name) : undefined,
    rawText: row.raw_text ? String(row.raw_text) : "",
    receivedAt: row.received_at ? new Date(row.received_at as string).toISOString() : undefined,
  };
}

export async function saveUnderstandingAsTask(input: UnderstandingInput, result: TaskUnderstandingResult) {
  const taskId = `task_${randomUUID()}`;
  const status = result.needsHumanReview ? "needs_review" : "pending_policy";
  const extractedFields = {
    ...result.fields,
    title: result.title,
    summary: result.summary,
    missingFields: result.missingFields,
    recommendedAction: result.recommendedAction,
    evidence: result.evidence,
    understandingEngine: result.engine,
  };

  if (!isDatabaseConfigured()) {
    const existing = input.intakeId
      ? [...memoryTasks.values()].find((task) => task.intake_id === input.intakeId)
      : null;
    const now = new Date().toISOString();
    const row = {
      id: existing?.id ?? taskId,
      company_id: input.companyId,
      intake_id: input.intakeId ?? null,
      task_type: result.taskType,
      status,
      extracted_fields_json: extractedFields,
      context_json: {},
      context_status: "not_matched",
      confidence: result.confidence,
      risk_level: result.riskLevel,
      assigned_to: null,
      due_at: result.fields.dueDate ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    memoryTasks.set(String(row.id), row);
    if (input.intakeId) setMemoryIntakeStatus(input.intakeId, "classified");
    return row;
  }

  const rows = await sql`
    INSERT INTO tasks (
      id,
      company_id,
      intake_id,
      task_type,
      status,
      extracted_fields_json,
      context_json,
      context_status,
      confidence,
      risk_level,
      due_at,
      updated_at
    )
    VALUES (
      ${taskId},
      ${input.companyId},
      ${input.intakeId ?? null},
      ${result.taskType},
      ${status},
      ${JSON.stringify(extractedFields)},
      ${JSON.stringify({})},
      'not_matched',
      ${result.confidence},
      ${result.riskLevel},
      ${result.fields.dueDate ?? null},
      NOW()
    )
    ON CONFLICT (intake_id) WHERE intake_id IS NOT NULL
    DO UPDATE SET
      task_type = EXCLUDED.task_type,
      status = EXCLUDED.status,
      extracted_fields_json = EXCLUDED.extracted_fields_json,
      context_json = '{}'::jsonb,
      context_status = 'not_matched',
      confidence = EXCLUDED.confidence,
      risk_level = EXCLUDED.risk_level,
      due_at = EXCLUDED.due_at,
      updated_at = NOW()
    RETURNING id, company_id, intake_id, task_type, status, extracted_fields_json, context_json, context_status, confidence, risk_level, due_at, created_at, updated_at
  `;

  if (input.intakeId) {
    await sql`
      UPDATE intakes
      SET status = 'classified'
      WHERE id = ${input.intakeId}
    `;
  }

  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    VALUES (
      ${input.companyId},
      'ai',
      'task_understood',
      'task',
      ${rows[0].id},
      ${JSON.stringify({
        intakeId: input.intakeId,
        taskType: result.taskType,
        confidence: result.confidence,
        riskLevel: result.riskLevel,
        engine: result.engine,
      })}
    )
  `;

  return rows[0];
}

export async function markIntakeUnderstandingFailed(intakeId: string, error: string) {
  if (!isDatabaseConfigured()) {
    setMemoryIntakeStatus(intakeId, "understanding_failed");
    return;
  }

  await sql`
    UPDATE intakes
    SET status = 'understanding_failed'
    WHERE id = ${intakeId}
  `;

  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    SELECT company_id, 'ai', 'task_understanding_failed', 'intake', id, ${JSON.stringify({ error })}
    FROM intakes
    WHERE id = ${intakeId}
  `;
}

export async function listTasks(input: { companyId?: string; status?: string; taskType?: string; limit?: number }) {
  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  if (!isDatabaseConfigured()) {
    return [...memoryTasks.values()]
      .filter((task) => task.company_id === companyId)
      .filter((task) => !input.status || task.status === input.status)
      .filter((task) => !input.taskType || task.task_type === input.taskType)
      .sort((a, b) => +(new Date(String(b.updated_at))) - +(new Date(String(a.updated_at))))
      .slice(0, limit);
  }

  if (input.status && input.taskType) {
    return await sql`
      SELECT id, company_id, intake_id, task_type, status, extracted_fields_json, context_json, context_status, confidence, risk_level, assigned_to, due_at, created_at, updated_at
      FROM tasks
      WHERE company_id = ${companyId} AND status = ${input.status} AND task_type = ${input.taskType}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
  }
  if (input.status) {
    return await sql`
      SELECT id, company_id, intake_id, task_type, status, extracted_fields_json, context_json, context_status, confidence, risk_level, assigned_to, due_at, created_at, updated_at
      FROM tasks
      WHERE company_id = ${companyId} AND status = ${input.status}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
  }
  if (input.taskType) {
    return await sql`
      SELECT id, company_id, intake_id, task_type, status, extracted_fields_json, context_json, context_status, confidence, risk_level, assigned_to, due_at, created_at, updated_at
      FROM tasks
      WHERE company_id = ${companyId} AND task_type = ${input.taskType}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
  }

  return await sql`
    SELECT id, company_id, intake_id, task_type, status, extracted_fields_json, context_json, context_status, confidence, risk_level, assigned_to, due_at, created_at, updated_at
    FROM tasks
    WHERE company_id = ${companyId}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
}

export async function listPendingUnderstandingIntakes(input: { companyId?: string; limit?: number }) {
  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

  if (!isDatabaseConfigured()) {
    return (await listIntakes({ companyId, limit: 200 }))
      .filter((row: Record<string, unknown>) => ["pending", "pending_classification"].includes(String(row.status)))
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => +(new Date(String(a.received_at ?? a.created_at))) - +(new Date(String(b.received_at ?? b.created_at))))
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        id: row.id,
        company_id: row.company_id,
        source_type: row.source_type,
        source_name: row.source_name,
        raw_text: row.raw_text,
        received_at: row.received_at,
      }));
  }

  return await sql`
    SELECT id, company_id, source_type, source_name, raw_text, received_at
    FROM intakes
    WHERE company_id = ${companyId}
      AND status IN ('pending', 'pending_classification')
    ORDER BY received_at ASC NULLS LAST, created_at ASC
    LIMIT ${limit}
  `;
}
