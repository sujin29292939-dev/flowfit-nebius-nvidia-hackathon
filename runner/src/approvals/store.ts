// approvals/store.ts
// APPROVAL_REQUIRED를 approval_requests 테이블과 Studio 카드 형태로 저장/조회한다.

import { createHash } from "node:crypto";
import { isDatabaseConfigured, sql } from "../db/client.js";
import { DEFAULT_COMPANY_ID } from "../intake/config.js";
import { saveRuleFromApprovalDecision } from "../memory/ruleMemory.js";
import { runAutonomyGateForCreateInput } from "../autonomyGate/runtime.js";
import type { CreateApprovalRequestInput, ApprovalRequestRecord } from "./types.js";

const DEFAULT_APPROVAL_TTL_MINUTES = 24 * 60;
const HIGH_RISK_APPROVAL_TTL_MINUTES = 4 * 60;

export class ApprovalExpiredError extends Error {
  approval: ApprovalRequestRecord;
  approvalId: string;
  taskId?: string;

  constructor(approval: ApprovalRequestRecord) {
    super(`Approval request expired: ${approval.id}`);
    this.name = "ApprovalExpiredError";
    this.approval = approval;
    this.approvalId = approval.id;
    this.taskId = approval.taskId;
  }
}

export class ApprovalAlreadyResolvedError extends Error {
  approval: ApprovalRequestRecord;
  approvalId: string;
  taskId?: string;

  constructor(approval: ApprovalRequestRecord) {
    super(`Approval request already resolved: ${approval.id} (${approval.status})`);
    this.name = "ApprovalAlreadyResolvedError";
    this.approval = approval;
    this.approvalId = approval.id;
    this.taskId = approval.taskId;
  }
}

export async function createApprovalRequest(input: CreateApprovalRequestInput) {
  const id = await buildApprovalIdForCreate(input);
  const title = input.title ?? buildApprovalTitle(input.action);
  const description = input.description ?? input.reason;
  const expiresAt = buildApprovalExpiresAt(input);
  const gateResult = await runAutonomyGateForCreateInput(input).catch((error) => {
    console.error(`[AutonomyGate] approval=${id} failed: ${String(error)}`);
    return null;
  });
  const metadata = {
    ...(input.metadata ?? {}),
    approvalExpiresAt: expiresAt.toISOString(),
    ...(gateResult ? { autonomyGate: gateResult } : {}),
  };
  const options = {
    type: "action_approval",
    action: input.action,
    reason: input.reason,
    runId: input.runId,
    source: input.source ?? "runner",
    choices: [
      { id: "approve", label: "승인" },
      { id: "reject", label: "반려" },
      { id: "revise", label: "수정 요청" },
    ],
    metadata,
  };

  if (gateResult?.effectiveOutcome === "AUTO_SEND") {
    return createAutoResolvedApprovalRequest(input, { id, title, description, options, gateResult });
  }

  const rows = await sql`
    INSERT INTO approval_requests (
      id,
      company_id,
      task_id,
      title,
      description,
      options_json,
      status,
      expires_at,
      created_at
    )
    VALUES (
      ${id},
      ${input.companyId},
      ${input.taskId ?? null},
      ${title},
      ${description},
      ${JSON.stringify(options)},
      'pending',
      ${expiresAt.toISOString()},
      NOW()
    )
    ON CONFLICT (id)
    DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      options_json = EXCLUDED.options_json,
      status = 'pending',
      selected_option = NULL,
      resolved_by = NULL,
      expires_at = EXCLUDED.expires_at,
      resolved_at = NULL
    RETURNING id, company_id, task_id, title, description, options_json, status, selected_option, resolved_by, created_at, expires_at, resolved_at
  `;

  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    VALUES (
      ${input.companyId},
      'ai',
      'approval_required_created',
      'approval_request',
      ${id},
      ${JSON.stringify({
        taskId: input.taskId,
        runId: input.runId,
        action: input.action,
        reason: input.reason,
        executionPath: input.metadata?.executionPath,
        deviceMode: input.metadata?.deviceMode,
        actionCapability: input.metadata?.actionCapability,
        offlineDemotion: input.metadata?.offlineDemotion,
        genericAgentResume: input.metadata?.genericAgentResume,
        previousGenericAgentApproval: input.metadata?.previousGenericAgentApproval,
      })}
    )
  `;

  return rowToApproval(rows[0]);
}

async function createAutoResolvedApprovalRequest(
  input: CreateApprovalRequestInput,
  prepared: {
    id: string;
    title: string;
    description: string;
    options: Record<string, unknown>;
    gateResult: unknown;
  },
) {
  const rows = await sql`
    INSERT INTO approval_requests (
      id,
      company_id,
      task_id,
      title,
      description,
      options_json,
      status,
      selected_option,
      resolved_by,
      created_at,
      resolved_at
    )
    VALUES (
      ${prepared.id},
      ${input.companyId},
      ${input.taskId ?? null},
      ${prepared.title},
      ${prepared.description},
      ${JSON.stringify(prepared.options)},
      'approved',
      'auto_send',
      'autonomy_gate',
      NOW(),
      NOW()
    )
    ON CONFLICT (id)
    DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      options_json = EXCLUDED.options_json,
      status = 'approved',
      selected_option = 'auto_send',
      resolved_by = 'autonomy_gate',
      resolved_at = NOW()
    RETURNING id, company_id, task_id, title, description, options_json, status, selected_option, resolved_by, created_at, expires_at, resolved_at
  `;

  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    VALUES (
      ${input.companyId},
      'ai',
      'autonomy_gate_auto_send',
      'approval_request',
      ${prepared.id},
      ${JSON.stringify({
        taskId: input.taskId,
        runId: input.runId,
        action: input.action,
        reason: input.reason,
        gateResult: prepared.gateResult,
      })}
    )
  `;

  return rowToApproval(rows[0]);
}

export async function listApprovalRequests(input: { companyId?: string; status?: string; limit?: number }) {
  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  const status = input.status ?? "pending";
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  const rows = await sql`
    SELECT
      ar.id,
      ar.company_id,
      ar.task_id,
      ar.title,
      ar.description,
      ar.options_json,
      ar.status,
      ar.selected_option,
      ar.resolved_by,
      ar.created_at,
      ar.expires_at,
      ar.resolved_at,
      t.task_type,
      t.extracted_fields_json,
      t.context_json,
      t.context_status,
      t.risk_level,
      t.confidence,
      t.intake_id
    FROM approval_requests ar
    LEFT JOIN tasks t ON t.id = ar.task_id
    WHERE ar.company_id = ${companyId}
      AND ar.status = ${status}
    ORDER BY ar.created_at DESC
    LIMIT ${limit}
  `;

  return rows.map(rowToApprovalWithTask);
}

export async function resolveApprovalRequest(input: {
  id: string;
  decision: "approved" | "rejected";
  resolvedBy?: string;
  note?: string;
  deviceId?: string;
  sessionId?: string;
}) {
  const currentRows = await sql`
    SELECT id, company_id, task_id, title, description, options_json, status, selected_option, resolved_by, created_at, expires_at, resolved_at
    FROM approval_requests
    WHERE id = ${input.id}
    LIMIT 1
  `;

  if (currentRows.length === 0) {
    throw new Error(`Approval request not found: ${input.id}`);
  }

  const current = currentRows[0];
  if (String(current.status) === "pending" && isApprovalExpired(current)) {
    const expired = await markApprovalExpired(current, input.resolvedBy);
    throw new ApprovalExpiredError(expired);
  }

  if (String(current.status) !== "pending") {
    const approval = rowToApproval(current);
    await recordDuplicateApprovalResolution(approval, input);
    throw new ApprovalAlreadyResolvedError(approval);
  }

  const selectedOption = input.decision === "approved" ? "approve" : "reject";
  const rows = await sql`
    UPDATE approval_requests
    SET
      status = ${input.decision},
      selected_option = ${selectedOption},
      resolved_by = ${input.resolvedBy ?? "owner"},
      resolved_at = NOW()
    WHERE id = ${input.id}
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > NOW())
    RETURNING id, company_id, task_id, title, description, options_json, status, selected_option, resolved_by, created_at, expires_at, resolved_at
  `;

  if (rows.length === 0) {
    const latestRows = await sql`
      SELECT id, company_id, task_id, title, description, options_json, status, selected_option, resolved_by, created_at, expires_at, resolved_at
      FROM approval_requests
      WHERE id = ${input.id}
      LIMIT 1
    `;
    if (latestRows.length && String(latestRows[0].status) === "pending" && isApprovalExpired(latestRows[0])) {
      const expired = await markApprovalExpired(latestRows[0], input.resolvedBy);
      throw new ApprovalExpiredError(expired);
    }
    if (latestRows.length) {
      const approval = rowToApproval(latestRows[0]);
      await recordDuplicateApprovalResolution(approval, input);
      throw new ApprovalAlreadyResolvedError(approval);
    }
    throw new Error(`Approval request could not be resolved: ${input.id}`);
  }

  const row = rows[0];
  await sql`
    INSERT INTO audit_logs (company_id, actor_type, actor_id, action, target_type, target_id, metadata_json)
    VALUES (
      ${String(row.company_id)},
      'user',
      ${input.resolvedBy ?? "owner"},
      ${input.decision === "approved" ? "approval_request_approved" : "approval_request_rejected"},
      'approval_request',
      ${input.id},
      ${JSON.stringify({ note: input.note, deviceId: input.deviceId, sessionId: input.sessionId })}
    )
  `;

  await updateTaskStatusFromApprovalResolution(row, input.decision);

  await saveRuleFromApprovalDecision({
    approvalId: input.id,
    decision: input.decision,
    resolvedBy: input.resolvedBy,
    note: input.note,
  }).catch((error) => {
    console.error(`[RuleMemory] approval=${input.id} failed: ${String(error)}`);
  });

  return rowToApproval(row);
}

export async function claimApprovedGenericAgentResume(input: {
  companyId: string;
  taskId: string;
  action: string;
  payloadHash: string;
  consumedByRunId: string;
}): Promise<ApprovalRequestRecord | null> {
  if (!isDatabaseConfigured()) return null;
  const consumedAt = new Date().toISOString();
  const rows = await sql`
    UPDATE approval_requests
    SET options_json = jsonb_set(
          jsonb_set(
            options_json,
            '{metadata,genericAgentResume,consumedAt}',
            to_jsonb(${consumedAt}::text),
            true
          ),
          '{metadata,genericAgentResume,consumedByRunId}',
          to_jsonb(${input.consumedByRunId}::text),
          true
        )
    WHERE id = (
      SELECT id
      FROM approval_requests
      WHERE company_id = ${input.companyId}
        AND task_id = ${input.taskId}
        AND status = 'approved'
        AND (expires_at IS NULL OR expires_at > NOW())
        AND options_json->>'action' = ${input.action}
        AND options_json->>'source' IN ('generic_agent_action_guard', 'action_guard')
        AND options_json #>> '{metadata,genericAgentResume,payloadHash}' = ${input.payloadHash}
        AND options_json #>> '{metadata,genericAgentResume,consumedAt}' IS NULL
      ORDER BY resolved_at DESC NULLS LAST, created_at DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, company_id, task_id, title, description, options_json, status, selected_option, resolved_by, created_at, expires_at, resolved_at
  `;

  if (!rows.length) return null;
  const approval = rowToApproval(rows[0]);
  await sql`
    INSERT INTO audit_logs (company_id, actor_type, actor_id, action, target_type, target_id, metadata_json)
    VALUES (
      ${input.companyId},
      'system',
      'generic_agent_approved_resume_claimed',
      'approval_request',
      ${approval.id},
      ${JSON.stringify({
        taskId: input.taskId,
        action: input.action,
        payloadHash: input.payloadHash,
        consumedByRunId: input.consumedByRunId,
        consumedAt,
      })}
    )
  `;
  return approval;
}

export async function findLatestApprovedGenericAgentResume(input: {
  companyId: string;
  taskId: string;
  action: string;
}): Promise<ApprovalRequestRecord | null> {
  if (!isDatabaseConfigured()) return null;
  const rows = await sql`
    SELECT id, company_id, task_id, title, description, options_json, status, selected_option, resolved_by, created_at, expires_at, resolved_at
    FROM approval_requests
    WHERE company_id = ${input.companyId}
      AND task_id = ${input.taskId}
      AND status = 'approved'
      AND options_json->>'action' = ${input.action}
      AND options_json->>'source' IN ('generic_agent_action_guard', 'action_guard')
      AND options_json #>> '{metadata,genericAgentResume,payloadHash}' IS NOT NULL
    ORDER BY resolved_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  `;
  return rows[0] ? rowToApproval(rows[0]) : null;
}

async function markApprovalExpired(row: Record<string, unknown>, actorId?: string): Promise<ApprovalRequestRecord> {
  const rows = await sql`
    UPDATE approval_requests
    SET
      status = 'expired',
      selected_option = 'expired',
      resolved_by = 'system',
      resolved_at = NOW()
    WHERE id = ${String(row.id)}
      AND status = 'pending'
    RETURNING id, company_id, task_id, title, description, options_json, status, selected_option, resolved_by, created_at, expires_at, resolved_at
  `;
  const expiredRow = rows[0] ?? row;

  await sql`
    INSERT INTO audit_logs (company_id, actor_type, actor_id, action, target_type, target_id, metadata_json)
    VALUES (
      ${String(expiredRow.company_id)},
      'system',
      ${actorId ?? "approval_ttl"},
      'approval_request_expired',
      'approval_request',
      ${String(expiredRow.id)},
      ${JSON.stringify({
        taskId: expiredRow.task_id,
        expiresAt: expiredRow.expires_at,
        reason: "approval_ttl_expired_before_resolution",
      })}
    )
  `;

  await updateTaskStatusFromApprovalResolution(expiredRow, "expired");
  return rowToApproval(expiredRow);
}

async function recordDuplicateApprovalResolution(
  approval: ApprovalRequestRecord,
  input: {
    decision: "approved" | "rejected";
    resolvedBy?: string;
    note?: string;
    deviceId?: string;
    sessionId?: string;
  },
) {
  await sql`
    INSERT INTO audit_logs (company_id, actor_type, actor_id, action, target_type, target_id, metadata_json)
    VALUES (
      ${approval.companyId},
      'user',
      ${input.resolvedBy ?? "owner"},
      'approval_duplicate_resolution_ignored',
      'approval_request',
      ${approval.id},
      ${JSON.stringify({
        attemptedDecision: input.decision,
        currentStatus: approval.status,
        resolvedBy: approval.resolvedBy,
        resolvedAt: approval.resolvedAt,
        note: input.note,
        deviceId: input.deviceId,
        sessionId: input.sessionId,
      })}
    )
  `;
}

async function updateTaskStatusFromApprovalResolution(row: Record<string, unknown>, decision: "approved" | "rejected" | "expired") {
  if (!row.task_id) return;
  const status = {
    approved: "approval_approved",
    rejected: "approval_rejected",
    expired: "approval_expired",
  }[decision];
  await sql`
    UPDATE tasks
    SET status = ${status},
        updated_at = NOW()
    WHERE id = ${String(row.task_id)}
  `;
}

export function toStudioAiWorkItem(row: Record<string, unknown>) {
  const options = asRecord(row.options_json);
  const metadata = asRecord(options.metadata);
  const extracted = asRecord(row.extracted_fields_json);
  const context = asRecord(row.context_json);
  const riskLevel = normalizeRisk(row.risk_level ?? metadata.riskLevel);
  const taskType = String(row.task_type ?? metadata.taskType ?? "");

  return {
    id: `runner-approval-${String(row.id)}`,
    companyId: String(row.company_id),
    title: String(row.title),
    type: mapTaskTypeToAiWorkType(taskType, String(options.action ?? "")),
    status: "waiting_approval",
    riskLevel,
    approvalPolicy: riskLevel === "high" ? "owner_only" : "approval_required",
    sourceType: mapSourceType(metadata.sourceType),
    sourceSummary: String(metadata.sourceSummary ?? row.intake_id ?? options.source ?? "Runner"),
    requestedByUserId: "flowfit-runner",
    requestedByName: "AI",
    aiReasonSummary: String(row.description ?? options.reason ?? "실행 전 승인이 필요한 작업입니다."),
    resultTitle: String(metadata.resultTitle ?? demotionResultTitle(metadata) ?? "승인 필요 작업"),
    resultContent: buildResultContent(row, extracted, context),
    previewMessage: String(options.reason ?? row.description ?? "승인 후 다음 실행 단계로 진행합니다."),
    instructionHistory: [],
    steps: [
      { id: `${String(row.id)}-step-1`, label: "업무 원문 이해", status: "done" },
      { id: `${String(row.id)}-step-2`, label: "거래처·품목·재고 확인", status: row.context_status ? "done" : "pending" },
      { id: `${String(row.id)}-step-3`, label: "위험도와 실행 권한 판단", status: "done" },
      { id: `${String(row.id)}-step-4`, label: "대표 승인 대기", status: "running" },
    ],
    executionPreview: {
      serviceName: "FlowFit Runner",
      screenName: "승인 대기 작업",
      safeActionSummary: [
        String(options.reason ?? "승인 필요한 행동이 감지되었습니다."),
        ...demotionHints(metadata),
        ...payloadChangeHints(metadata),
        ...contextHints(context),
      ].slice(0, 5),
      lastUpdatedAt: new Date(row.created_at as string).toISOString(),
    },
    createdAt: new Date(row.created_at as string).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at as string).toISOString() : undefined,
    updatedAt: new Date((row.resolved_at as string | undefined) ?? (row.created_at as string)).toISOString(),
  };
}

function rowToApproval(row: Record<string, unknown>): ApprovalRequestRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    taskId: row.task_id ? String(row.task_id) : undefined,
    title: String(row.title),
    description: row.description ? String(row.description) : undefined,
    options: asRecord(row.options_json),
    status: String(row.status) as ApprovalRequestRecord["status"],
    selectedOption: row.selected_option ? String(row.selected_option) : undefined,
    resolvedBy: row.resolved_by ? String(row.resolved_by) : undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at as string).toISOString() : undefined,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string).toISOString() : undefined,
  };
}

function rowToApprovalWithTask(row: Record<string, unknown>) {
  return {
    ...rowToApproval(row),
    taskType: row.task_type ? String(row.task_type) : undefined,
    riskLevel: row.risk_level ? String(row.risk_level) : undefined,
    contextStatus: row.context_status ? String(row.context_status) : undefined,
    studioCard: toStudioAiWorkItem(row),
  };
}

function buildApprovalExpiresAt(input: CreateApprovalRequestInput): Date {
  if (input.expiresAt) {
    const explicit = new Date(input.expiresAt);
    if (!Number.isNaN(explicit.getTime())) return explicit;
  }

  const minutes = approvalTtlMinutes(input);
  return new Date(Date.now() + minutes * 60_000);
}

function approvalTtlMinutes(input: CreateApprovalRequestInput): number {
  const metadataTtl = numberFromUnknown(input.metadata?.approvalTtlMinutes);
  const explicitTtl = numberFromUnknown(input.ttlMinutes);
  const envDefault = numberFromUnknown(process.env.APPROVAL_REQUEST_TTL_MINUTES);
  const envHighRisk = numberFromUnknown(process.env.HIGH_RISK_APPROVAL_REQUEST_TTL_MINUTES);
  const selected = metadataTtl ?? explicitTtl ?? (
    input.riskLevel === "high" || input.approvalPolicy === "owner_only"
      ? envHighRisk ?? HIGH_RISK_APPROVAL_TTL_MINUTES
      : envDefault ?? DEFAULT_APPROVAL_TTL_MINUTES
  );

  return clampMinutes(selected, 1, 7 * 24 * 60);
}

function clampMinutes(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return DEFAULT_APPROVAL_TTL_MINUTES;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isApprovalExpired(row: Record<string, unknown>): boolean {
  if (!row.expires_at) return false;
  const expiresAt = new Date(row.expires_at as string);
  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= Date.now();
}

function buildApprovalId(input: CreateApprovalRequestInput) {
  const stable = [
    input.companyId,
    input.taskId ?? "",
    input.runId ?? "",
    input.action,
  ].join("|");
  return `approval_${createHash("sha256").update(stable).digest("hex").slice(0, 24)}`;
}

async function buildApprovalIdForCreate(input: CreateApprovalRequestInput) {
  const baseId = buildApprovalId(input);
  const rows = await sql`
    SELECT status
    FROM approval_requests
    WHERE id = ${baseId}
    LIMIT 1
  `;
  if (rows.length === 0 || String(rows[0].status) === "pending") return baseId;
  return `${baseId}_${Date.now().toString(36)}`;
}

function buildApprovalTitle(action: string) {
  const label = {
    store_session_cookie: "사이트 세션 저장 승인",
    use_saved_session: "저장된 세션 사용 승인",
    send_order_confirm: "거래처 답장 발송 승인",
    create_order: "주문 등록 승인",
    create_shipping_task: "출고 지시 승인",
    update_spreadsheet: "업무 파일 수정 승인",
  }[action] ?? "AI 실행 승인 필요";
  return label;
}

function buildResultContent(row: Record<string, unknown>, extracted: Record<string, unknown>, context: Record<string, unknown>) {
  const options = asRecord(row.options_json);
  const metadata = asRecord(options.metadata);
  const lines = [
    row.description ? String(row.description) : "",
    ...demotionHints(metadata),
    ...payloadChangeHints(metadata),
    extracted.summary ? `요약: ${String(extracted.summary)}` : "",
    extracted.customerName ? `거래처: ${String(extracted.customerName)}` : "",
    extracted.itemName ? `품목: ${String(extracted.itemName)}` : "",
    extracted.quantity ? `수량: ${String(extracted.quantity)}${String(extracted.unit ?? "")}` : "",
    extracted.amount ? `금액: ${Number(extracted.amount).toLocaleString("ko-KR")}원` : "",
    context.recommendedAction ? `추천 처리: ${String(context.recommendedAction)}` : "",
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : "승인 후 AI가 다음 실행 단계를 진행합니다.";
}

function contextHints(context: Record<string, unknown>) {
  const hints = context.decisionHints;
  return Array.isArray(hints) ? hints.filter((item): item is string => typeof item === "string") : [];
}

function demotionResultTitle(metadata: Record<string, unknown>) {
  if (metadata.offlineDemotion === "AUTO_TO_ASSIST") return "실행 PC 오프라인으로 승인 필요";
  return undefined;
}

function demotionHints(metadata: Record<string, unknown>) {
  if (metadata.offlineDemotion !== "AUTO_TO_ASSIST") return [];
  const mode = String(metadata.deviceMode ?? "OFFLINE");
  const capability = String(metadata.actionCapability ?? "write");
  return [
    `강등 사유: 실행 PC 상태가 ${mode}이어서 ${capability} 작업을 자동 실행하지 않고 승인 대기로 전환했습니다.`,
  ];
}

function payloadChangeHints(metadata: Record<string, unknown>) {
  const previous = asRecord(metadata.previousGenericAgentApproval);
  if (previous.reason !== "approved_payload_changed") return [];
  return [
    [
      "이전 승인 내용과 달라져 재승인이 필요합니다.",
      `이전 승인 카드: ${String(previous.originCardId ?? "unknown")}`,
      `이전 payload: ${String(previous.approvedPayloadHash ?? "unknown").slice(0, 12)}`,
      `현재 payload: ${String(previous.currentPayloadHash ?? "unknown").slice(0, 12)}`,
    ].join(" "),
  ];
}

function mapTaskTypeToAiWorkType(taskType: string, action: string) {
  if (taskType === "order_request" || action.includes("order")) return "order_check";
  if (taskType === "quote_request") return "report";
  if (taskType === "delivery_inquiry" || action.includes("send")) return "customer_reply";
  if (taskType === "payment_report") return "report";
  return "manual_request";
}

function mapSourceType(value: unknown) {
  const source = String(value ?? "system");
  if (["sms", "email", "website", "spreadsheet", "manual", "messenger", "file", "system"].includes(source)) {
    return source;
  }
  return "system";
}

function normalizeRisk(value: unknown) {
  const risk = String(value ?? "medium");
  if (risk === "low" || risk === "medium" || risk === "high" || risk === "uncertain") return risk;
  return "medium";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}
