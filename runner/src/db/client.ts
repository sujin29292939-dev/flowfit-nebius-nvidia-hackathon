// db/client.ts
// Neon PostgreSQL: agent_runs · agent_events · agent_files

import { neon } from "@neondatabase/serverless";
import type { AgentEvent } from "../agent/events.js";

const fallbackSql = Object.assign(
  async () => [],
  { unsafe: async () => [] },
) as unknown;

const hasDatabase = Boolean(process.env.DATABASE_URL);
export const sql: any = hasDatabase ? neon(process.env.DATABASE_URL as string) : fallbackSql;
export function isDatabaseConfigured() {
  return hasDatabase;
}

const memoryRuns = new Map<string, { task: string; status: string; result?: string }>();
const memoryEvents = new Map<string, AgentEvent[]>();
const memoryFiles = new Map<string, Array<{ path: string; sizeBytes?: number }>>();

// ─────────────────────────────────────────────
// agent_runs
// ─────────────────────────────────────────────
export async function createRun(runId: string, task: string): Promise<void> {
  if (!hasDatabase) {
    memoryRuns.set(runId, { task, status: "running" });
    return;
  }

  await sql`
    INSERT INTO agent_runs (id, task, status)
    VALUES (${runId}, ${task}, 'running')
    ON CONFLICT (id) DO UPDATE SET status = 'running', updated_at = NOW()
  `;
}

export async function completeRun(runId: string, result: string): Promise<void> {
  if (!hasDatabase) {
    const current = memoryRuns.get(runId);
    memoryRuns.set(runId, { task: current?.task ?? "", status: "done", result });
    return;
  }

  await sql`
    UPDATE agent_runs
    SET status = 'done', result = ${result},
        updated_at = NOW(), completed_at = NOW()
    WHERE id = ${runId}
  `;
}

export async function failRun(runId: string, error: string): Promise<void> {
  if (!hasDatabase) {
    const current = memoryRuns.get(runId);
    memoryRuns.set(runId, { task: current?.task ?? "", status: "error", result: error });
    return;
  }

  await sql`
    UPDATE agent_runs
    SET status = 'error', result = ${error}, updated_at = NOW()
    WHERE id = ${runId}
  `;
}

// ─────────────────────────────────────────────
// agent_events: append-only, 절대 UPDATE 없음
// ─────────────────────────────────────────────
export async function appendEvent(
  runId: string,
  seq: number,
  event: AgentEvent
): Promise<void> {
  if (!hasDatabase) {
    const events = memoryEvents.get(runId) ?? [];
    events[seq] = event;
    memoryEvents.set(runId, events);
    return;
  }

  const isError =
    event.type === "tool_result" ? (event as { isError: boolean }).isError : false;
  const offloadedPath =
    event.type === "tool_result"
      ? (event as { offloadedPath?: string }).offloadedPath ?? null
      : null;

  // payload에서 대용량 content는 오프로딩됐으면 제거 (DB 비대화 방지)
  const payload = { ...event } as Record<string, unknown>;
  if (offloadedPath && payload.content) {
    payload.content = `[offloaded: ${offloadedPath}]`;
  }

  await sql`
    INSERT INTO agent_events (run_id, event_type, seq, payload, is_error, offloaded_path)
    VALUES (${runId}, ${event.type}, ${seq}, ${JSON.stringify(payload)}, ${isError}, ${offloadedPath})
  `;
}

// Studio가 특정 run의 전체 이벤트 이력을 읽을 때
export async function getEvents(runId: string): Promise<AgentEvent[]> {
  if (!hasDatabase) {
    return (memoryEvents.get(runId) ?? []).filter(Boolean);
  }

  const rows = await sql`
    SELECT payload FROM agent_events
    WHERE run_id = ${runId}
    ORDER BY seq ASC
  `;
  return rows.map((r: { payload: AgentEvent }) => r.payload);
}

// ─────────────────────────────────────────────
// agent_files
// ─────────────────────────────────────────────
export async function recordFile(
  runId: string,
  filePath: string,
  sizeBytes?: number
): Promise<void> {
  if (!hasDatabase) {
    const files = memoryFiles.get(runId) ?? [];
    files.push({ path: filePath, sizeBytes });
    memoryFiles.set(runId, files);
    return;
  }

  await sql`
    INSERT INTO agent_files (run_id, path, size_bytes)
    VALUES (${runId}, ${filePath}, ${sizeBytes ?? null})
    ON CONFLICT DO NOTHING
  `;
}
