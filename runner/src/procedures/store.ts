// procedures/store.ts
// SHADOW 절차 관찰 수집 → 후보 생성 → 사람 승격.
// rule_memory 패턴을 그대로 따른다: 관찰·후보는 AI/에이전트가, 활성화는 사람만.

import { createHash, randomUUID } from "node:crypto";

import { isDatabaseConfigured, sql } from "../db/client.js";

export interface ObservedAction {
  op: string;
  target?: string;
  valueShape?: string; // 마스킹된 값 형태만 (비밀번호·PII 금지)
  observedAt?: string;
}

export interface ProcedureCandidate {
  id: string;
  companyId: string;
  capability: string;
  erpKey?: string;
  signature: string;
  steps: Array<{ op: string; target?: string }>;
  observedCount: number;
  status: "candidate" | "active" | "rejected";
  createdAt: string;
  updatedAt: string;
}

// 메모리 폴백
const memObservations: Array<{ id: string; companyId: string; capability?: string; actions: ObservedAction[] }> = [];
const memCandidates = new Map<string, ProcedureCandidate>();

/** 관찰 시퀀스에서 "절차 형태" 서명 생성 — op+target 순서만(값 제외) */
function procedureSignature(actions: ObservedAction[]): string {
  const shape = actions.map((a) => `${a.op}:${a.target ?? ""}`).join(">");
  return createHash("sha256").update(shape).digest("hex").slice(0, 16);
}

/** 민감 조작 필터: 비밀번호 입력 등은 관찰에서 제외 */
function sanitizeActions(actions: ObservedAction[]): ObservedAction[] {
  return actions.filter((a) => {
    const t = (a.target ?? "").toLowerCase();
    if (t.includes("password") || t.includes("passwd") || t.includes("pwd")) return false;
    return true;
  }).map((a) => ({ op: a.op, target: a.target, valueShape: a.valueShape, observedAt: a.observedAt ?? new Date().toISOString() }));
}

/**
 * 관찰 배치 기록 + 절차 후보 생성/증가.
 * 같은 형태(서명)가 반복되면 observed_count를 올린다.
 */
export async function recordObservationBatch(input: {
  companyId: string;
  deviceId: string;
  capability?: string;
  actions: ObservedAction[];
}): Promise<{ observationId: string; candidateId: string | null; observedCount: number }> {
  const actions = sanitizeActions(input.actions);
  if (actions.length === 0) {
    return { observationId: "", candidateId: null, observedCount: 0 };
  }

  const observationId = randomUUID();
  const signature = procedureSignature(actions);
  const steps = actions.map((a) => ({ op: a.op, target: a.target }));

  if (!isDatabaseConfigured()) {
    memObservations.push({ id: observationId, companyId: input.companyId, capability: input.capability, actions });
    // 후보는 capability가 있을 때만 형성
    if (!input.capability) return { observationId, candidateId: null, observedCount: 0 };
    const key = `${input.companyId}:${input.capability}:${signature}`;
    const existing = [...memCandidates.values()].find(
      (c) => c.companyId === input.companyId && c.capability === input.capability && c.signature === signature,
    );
    if (existing) {
      existing.observedCount += 1;
      existing.updatedAt = new Date().toISOString();
      return { observationId, candidateId: existing.id, observedCount: existing.observedCount };
    }
    const candidate: ProcedureCandidate = {
      id: randomUUID(), companyId: input.companyId, capability: input.capability,
      signature, steps, observedCount: 1, status: "candidate",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    memCandidates.set(candidate.id, candidate);
    return { observationId, candidateId: candidate.id, observedCount: 1 };
  }

  await sql`
    INSERT INTO procedure_observations (id, company_id, device_id, capability, actions_json, signature)
    VALUES (${observationId}, ${input.companyId}, ${input.deviceId}, ${input.capability ?? null}, ${JSON.stringify(actions)}, ${signature})
  `;
  if (!input.capability) return { observationId, candidateId: null, observedCount: 0 };

  const rows = await sql`
    INSERT INTO procedure_candidates (id, company_id, capability, signature, steps_json, observed_count, status)
    VALUES (${randomUUID()}, ${input.companyId}, ${input.capability}, ${signature}, ${JSON.stringify(steps)}, 1, 'candidate')
    ON CONFLICT (company_id, capability, signature)
    DO UPDATE SET observed_count = procedure_candidates.observed_count + 1, updated_at = NOW()
    RETURNING id, observed_count
  `;
  return { observationId, candidateId: String(rows[0].id), observedCount: Number(rows[0].observed_count) };
}

export async function listProcedureCandidates(input: { companyId?: string; status?: string } = {}): Promise<ProcedureCandidate[]> {
  if (!isDatabaseConfigured()) {
    return [...memCandidates.values()].filter(
      (c) => (!input.companyId || c.companyId === input.companyId) && (!input.status || c.status === input.status),
    ).sort((a, b) => b.observedCount - a.observedCount);
  }
  const rows = input.companyId
    ? await sql`SELECT * FROM procedure_candidates WHERE company_id = ${input.companyId} ${input.status ? sql`AND status = ${input.status}` : sql``} ORDER BY observed_count DESC`
    : await sql`SELECT * FROM procedure_candidates ORDER BY observed_count DESC`;
  return rows.map(rowToCandidate);
}

/** 사람 승격: 후보 → 활성. 활성화의 유일한 경로. */
export async function promoteProcedureCandidate(input: {
  candidateId: string;
  promotedBy: string;
  isAdmin: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!input.isAdmin) return { ok: false, reason: "admin_required" };

  if (!isDatabaseConfigured()) {
    const c = memCandidates.get(input.candidateId);
    if (!c) return { ok: false, reason: "not_found" };
    c.status = "active";
    c.updatedAt = new Date().toISOString();
    return { ok: true };
  }
  const rows = await sql`
    UPDATE procedure_candidates
    SET status = 'active', promoted_by = ${input.promotedBy}, promoted_at = NOW(), updated_at = NOW()
    WHERE id = ${input.candidateId} RETURNING id
  `;
  return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

function rowToCandidate(row: Record<string, unknown>): ProcedureCandidate {
  return {
    id: String(row.id), companyId: String(row.company_id), capability: String(row.capability),
    erpKey: (row.erp_key as string) ?? undefined, signature: String(row.signature),
    steps: parseJson(row.steps_json, []) as Array<{ op: string; target?: string }>,
    observedCount: Number(row.observed_count), status: row.status as ProcedureCandidate["status"],
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return fallback; } }
  return fallback;
}
