import { sql } from "../db/client.js";
import { DEFAULT_COMPANY_ID } from "../intake/config.js";
import { createApprovalRequest } from "../approvals/store.js";
import { findApplicableRulesForTask } from "../memory/ruleMemory.js";
import { getCompanyDeviceOperationStatus } from "../devices/store.js";
import { runAutonomyGateForCreateInput } from "../autonomyGate/runtime.js";
import { evaluateTaskAutonomy } from "../autonomyGate/decisionGate.js";
import type { CreateApprovalRequestInput } from "../approvals/types.js";
import type { RiskLevel } from "../autonomyGate/types.js";
import { ConnectorResolver, INTENT_CAPABILITY, WorkIntent, runHealthCheck, type ResolvedConnector, type WorkIntent as WorkIntentValue } from "./connectorResolver.js";
import type { AutonomyDecision, PipelineDeps, WorkEvent, WorkResult } from "./workExecutionPipeline.js";
import { runApprovedWork, runWork } from "./workExecutionPipeline.js";
import { buildHttpCall, type HttpPort } from "./connectorExecutor.js";
import {
  createConnectorResolverDeps,
  getMappingProfile,
  listCompanyConnectorLinks,
  listConnectorConnections,
  listConnectorDefinitions,
  updateConnectorHealth,
  type UpsertConnectorConnectionInput,
  upsertConnectorConnection,
} from "./connectorStore.js";
import { isWriteCapability, type Capability, type MappingProfile } from "./connectorTypes.js";
import type { RuleRef } from "./offlinePolicy.js";
import {
  buildConnectorApprovalPayloadHash,
  CONNECTOR_APPROVAL_PAYLOAD_HASH_VERSION,
} from "./payloadHash.js";

type TaskExecutionRow = {
  id: string;
  companyId: string;
  taskType: string;
  status: string;
  extractedFields: Record<string, unknown>;
  context: Record<string, unknown>;
  contextStatus: string;
  confidence: number;
  riskLevel: RiskLevel;
};

type RuleMemoryHint = {
  id: string;
  effect?: string;
  ruleText?: string;
  confidence?: number;
  ruleJson?: Record<string, unknown>;
};

export async function runTaskViaConnectors(taskId: string): Promise<WorkResult & { taskId: string }> {
  const task = await getTaskForConnectorRun(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const existing = await existingConnectorRunResult(task);
  if (existing) return { ...existing, taskId };

  const intent = mapTaskTypeToIntent(task.taskType, task.extractedFields);
  const claimed = await claimTaskForConnectorRun(task.id);
  if (!claimed) {
    const latest = await getTaskForConnectorRun(taskId);
    const latestResult = latest ? await existingConnectorRunResult(latest) : null;
    return {
      ...(latestResult ?? { status: "blocked", reason: "이미 다른 실행에서 이 작업을 처리 중입니다." }),
      taskId,
    };
  }

  const ruleMemory = await loadRuleMemoryHint(taskId);
  const payload = buildTaskPayload(task, ruleMemory);
  const deps = await createConnectorPipelineDeps(task, ruleMemory);
  if (task.status === "approval_approved") {
    const approvedPayload = await verifyApprovedConnectorPayload(task, intent, payload, deps);
    if (!approvedPayload.ok) {
      const approval = await createPayloadChangedApproval(task, intent, payload, ruleMemory, approvedPayload);
      await updateTaskExecutionState(task.id, "waiting_approval", {
        status: "payload_hash_mismatch",
        approvalId: approval.id,
        intent,
        expectedPayloadHash: approvedPayload.expectedPayloadHash,
        currentPayloadHash: approvedPayload.currentPayloadHash,
      });
      return { status: "needs_approval", approvalId: approval.id, connectorKey: "connector_resolver", taskId };
    }
    if (approvedPayload.resolved) {
      const result = await runApprovedWork({
        companyId: task.companyId,
        intent,
        resolved: approvedPayload.resolved,
        payload,
      }, deps);
      await updateTaskExecutionState(task.id, mapWorkResultToTaskStatus(result, intent), buildExecutionMetadata(result, intent));
      return { ...result, taskId };
    }
  }
  const result = await runWork({ companyId: task.companyId, intent, payload }, deps);

  if (result.status === "no_connector") {
    const approval = await createConnectorSetupApproval(task, intent, result.fallback);
    await updateTaskExecutionState(task.id, "waiting_connector", {
      status: result.status,
      fallback: result.fallback,
      approvalId: approval.id,
      intent,
    });
    return { status: "needs_approval", approvalId: approval.id, connectorKey: "connector_setup", taskId };
  }

  await updateTaskExecutionState(task.id, mapWorkResultToTaskStatus(result, intent), buildExecutionMetadata(result, intent));
  return { ...result, taskId };
}

export async function listConnectorRuntimeStatus(companyId = DEFAULT_COMPANY_ID) {
  const [definitions, connections, links] = await Promise.all([
    listConnectorDefinitions(),
    listConnectorConnections(companyId),
    listCompanyConnectorLinks(companyId),
  ]);
  return {
    companyId,
    definitions,
    connections: connections.map((connection) => ({
      ...connection,
      credentialRef: redactCredentialRef(connection.credentialRef),
    })),
    companyConnectors: links,
  };
}

export async function registerConnectorConnection(input: UpsertConnectorConnectionInput) {
  const result = await upsertConnectorConnection(input);
  return {
    connection: { ...result.connection, credentialRef: redactCredentialRef(result.connection.credentialRef) },
    companyConnector: result.companyConnector,
  };
}

export async function runConnectorHealthChecks(companyId = DEFAULT_COMPANY_ID) {
  const deps = await createConnectorResolverDeps();
  const connections = await listConnectorConnections(companyId);
  const checked = [];

  for (const connection of connections) {
    const updated = await runHealthCheck(connection, {
      resolveCredential: deps.resolveCredential,
      probe: {
        async probe(conn, credential) {
          const profile = await getMappingProfile(conn.connectorKey);
          if (!profile) return false;
          const call = buildHttpCall(profile, credential, {
            method: profile.healthMethod,
            path: profile.healthPath,
          });
          const response = await fetch(call.url, { method: call.method, headers: call.headers });
          return response.status >= 200 && response.status < 500;
        },
      },
      persist: async (connection) => {
        await updateConnectorHealth(connection);
      },
    });
    checked.push({ ...updated, credentialRef: redactCredentialRef(updated.credentialRef) });
  }

  return { companyId, count: checked.length, connections: checked };
}

export function mapTaskTypeToIntent(taskType: string, fields: Record<string, unknown> = {}): WorkIntentValue {
  const action = String(fields.recommendedAction ?? "").toLowerCase();
  if (taskType === "order_request") return "register_order";
  if (taskType === "quote_request") return "create_quote";
  if (taskType === "inventory_check") return "read_inventory";
  if (taskType === "delivery_inquiry") return action.includes("reply") ? "reply_inquiry" : "track_shipment";
  if (taskType === "payment_report") return "check_payment";
  if (taskType === "complaint") return "handle_complaint";
  if (taskType === "report_request") return "create_report";
  if (taskType === "automation_request") return "create_automation";
  if (taskType === "reply_draft") return "reply_inquiry";
  return "reply_inquiry";
}

function createConnectorPipelineDeps(task: TaskExecutionRow, ruleMemory: RuleMemoryHint | null): Promise<PipelineDeps> {
  return createConnectorResolverDeps().then((resolverDeps) => ({
    resolver: new ConnectorResolver(resolverDeps),
    actionGuard: {
      async check(args) {
        const action = intentToAction(args.intent);
        if (isBlockedAction(action)) {
          return { allowed: false, reason: `${action} 작업은 FlowFit 자동 실행에서 차단됩니다.` };
        }
        return { allowed: true };
      },
    },
    autonomyGate: {
      async evaluate(args) {
        const action = intentToAction(args.intent);
        const ruleEffect = ruleMemory?.effect;
        const gateInput = buildApprovalInput(task, args.intent, args.connectorKey, action, ruleMemory, args.payload);
        const gate = await runAutonomyGateForCreateInput(gateInput);
        const profile = await getMappingProfile(args.connectorKey);
        const deviceStatus = await getCompanyDeviceOperationStatus({ companyId: task.companyId }).catch(() => null);
        return evaluateTaskAutonomy({
          capability: args.capability,
          riskLevel: task.riskLevel,
          ruleEffect,
          ruleText: ruleMemory?.ruleText,
          rule: buildOfflineRuleRef(ruleMemory, profile),
          deviceMode: deviceStatus?.mode ?? "OFFLINE",
          gate,
        });
      },
    },
    approvals: {
      async createCard(args) {
        const approval = await createApprovalRequest(buildApprovalInput(
          task,
          args.intent,
          args.connectorKey,
          intentToAction(args.intent),
          ruleMemory,
          args.payload,
          args.proposedCall,
        ));
        return { approvalId: approval.id };
      },
    },
    http: fetchHttpPort,
    getProfile(connectorKey: string) {
      return getMappingProfile(connectorKey);
    },
    events: {
      async emit(event) {
        await appendConnectorEvent(task, event);
      },
    },
  }));
}

const fetchHttpPort: HttpPort = {
  async request(args) {
    const response = await fetch(args.url, {
      method: args.method,
      headers: args.headers,
      body: args.body,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const json = contentType.includes("application/json") ? await response.json() : { text: await response.text() };
    return { status: response.status, json };
  },
};

async function getTaskForConnectorRun(taskId: string): Promise<TaskExecutionRow | null> {
  const rows = await sql`
    SELECT id, company_id, task_type, status, extracted_fields_json, context_json, context_status, confidence, risk_level
    FROM tasks
    WHERE id = ${taskId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    taskType: String(row.task_type),
    status: String(row.status),
    extractedFields: asRecord(row.extracted_fields_json),
    context: asRecord(row.context_json),
    contextStatus: String(row.context_status ?? "not_matched"),
    confidence: typeof row.confidence === "number" ? row.confidence : Number(row.confidence ?? 0),
    riskLevel: normalizeRisk(row.risk_level),
  };
}

async function claimTaskForConnectorRun(taskId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE tasks
    SET status = 'connector_executing', updated_at = NOW()
    WHERE id = ${taskId}
      AND status NOT IN (
        'connector_executing',
        'waiting_approval',
        'waiting_connector',
        'completed',
        'blocked',
        'shadowed',
        'failed',
        'connector_reauth_required',
        'approval_rejected'
      )
    RETURNING id
  `;
  return rows.length > 0;
}

async function existingConnectorRunResult(task: TaskExecutionRow): Promise<WorkResult | null> {
  if (task.status === "waiting_approval") {
    const approvalId = await findPendingConnectorApproval(task.id);
    return approvalId
      ? { status: "needs_approval", approvalId, connectorKey: "connector_resolver" }
      : { status: "blocked", reason: "이미 승인 대기 상태인 작업입니다." };
  }
  if (task.status === "waiting_connector") {
    const approvalId = await findPendingConnectorApproval(task.id);
    return approvalId
      ? { status: "needs_approval", approvalId, connectorKey: "connector_setup" }
      : { status: "no_connector", fallback: "ask_connect" };
  }
  if (task.status === "connector_executing") {
    return { status: "blocked", reason: "이미 실행 중인 작업입니다." };
  }
  if (["completed", "blocked", "shadowed", "failed", "connector_reauth_required", "approval_rejected"].includes(task.status)) {
    return { status: "blocked", reason: `이미 처리된 작업입니다. 현재 상태: ${task.status}` };
  }
  return null;
}

async function findPendingConnectorApproval(taskId: string): Promise<string | null> {
  const rows = await sql`
    SELECT id
    FROM approval_requests
    WHERE task_id = ${taskId}
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows.length ? String(rows[0].id) : null;
}

type ApprovedPayloadCheck =
  | { ok: true; resolved?: ResolvedConnector }
  | {
      ok: false;
      reason: string;
      approvalId?: string;
      expectedPayloadHash?: string;
      currentPayloadHash?: string;
      connectorKey?: string;
      proposedCall?: { method: string; baseUrl: string; path: string };
    };

async function verifyApprovedConnectorPayload(
  task: TaskExecutionRow,
  intent: WorkIntentValue,
  payload: Record<string, unknown>,
  deps: PipelineDeps,
): Promise<ApprovedPayloadCheck> {
  const approval = await findLatestApprovedConnectorApproval(task.id);
  if (!approval) {
    return { ok: false, reason: "승인된 connector approval을 찾을 수 없습니다." };
  }

  const metadata = asRecord(asRecord(approval.options_json).metadata);
  const expectedPayloadHash = typeof metadata.approvalPayloadHash === "string"
    ? metadata.approvalPayloadHash
    : undefined;
  const approvalScope = typeof metadata.approvalScope === "string" ? metadata.approvalScope : undefined;

  const resolved = await deps.resolver.resolve(task.companyId, intent);
  if (!resolved.ok) {
    return { ok: true };
  }

  const profile = await deps.getProfile(resolved.chosen.connectorKey);
  const capability = INTENT_CAPABILITY[intent];
  const proposedCall = profile
    ? { method: profile.endpoint.method, baseUrl: profile.baseUrl, path: profile.endpoint.path }
    : undefined;
  const currentPayloadHash = buildConnectorApprovalPayloadHash({
    companyId: task.companyId,
    taskId: task.id,
    intent,
    capability,
    connectorKey: resolved.chosen.connectorKey,
    payload,
    proposedCall,
  });

  if (isApprovalRowExpired(approval)) {
    await markApprovedConnectorApprovalExpired(approval, task.id);
    return {
      ok: false,
      reason: "승인 카드의 유효기간이 지나 현재 맥락으로 재승인이 필요합니다.",
      approvalId: String(approval.id),
      expectedPayloadHash,
      currentPayloadHash,
      connectorKey: resolved.chosen.connectorKey,
      proposedCall,
    };
  }

  if (approvalScope !== "exact_payload" || !expectedPayloadHash) {
    return {
      ok: false,
      reason: "기존 승인이 exact payload 범위로 고정되어 있지 않습니다.",
      approvalId: String(approval.id),
      expectedPayloadHash,
      currentPayloadHash,
      connectorKey: resolved.chosen.connectorKey,
      proposedCall,
    };
  }

  if (expectedPayloadHash !== currentPayloadHash) {
    return {
      ok: false,
      reason: "승인 당시 payload와 현재 실행 payload가 다릅니다.",
      approvalId: String(approval.id),
      expectedPayloadHash,
      currentPayloadHash,
      connectorKey: resolved.chosen.connectorKey,
      proposedCall,
    };
  }

  return { ok: true, resolved: resolved.chosen };
}

async function findLatestApprovedConnectorApproval(taskId: string): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT id, company_id, task_id, options_json, expires_at, resolved_at, created_at
    FROM approval_requests
    WHERE task_id = ${taskId}
      AND status = 'approved'
    ORDER BY resolved_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function isApprovalRowExpired(row: Record<string, unknown>): boolean {
  if (!row.expires_at) return false;
  const expiresAt = Date.parse(String(row.expires_at));
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

async function markApprovedConnectorApprovalExpired(row: Record<string, unknown>, taskId: string) {
  await sql`
    UPDATE approval_requests
    SET status = 'expired',
        selected_option = 'expired',
        resolved_by = 'system',
        resolved_at = NOW()
    WHERE id = ${String(row.id)}
      AND status = 'approved'
  `;
  await sql`
    INSERT INTO audit_logs (company_id, actor_type, actor_id, action, target_type, target_id, metadata_json)
    VALUES (
      ${String(row.company_id)},
      'system',
      'approval_ttl',
      'approved_connector_payload_expired_before_execution',
      'approval_request',
      ${String(row.id)},
      ${JSON.stringify({ taskId, expiresAt: row.expires_at })}
    )
  `;
}

async function createPayloadChangedApproval(
  task: TaskExecutionRow,
  intent: WorkIntentValue,
  payload: Record<string, unknown>,
  ruleMemory: RuleMemoryHint | null,
  check: Exclude<ApprovedPayloadCheck, { ok: true }>,
) {
  const action = intentToAction(intent);
  const input = buildApprovalInput(
    task,
    intent,
    check.connectorKey ?? "connector_resolver",
    action,
    ruleMemory,
    payload,
    check.proposedCall,
  );

  return createApprovalRequest({
    ...input,
    title: `${input.title} 재승인 필요`,
    reason: `${input.reason}\n\n${check.reason}`,
    description: `${input.description ?? input.reason}\n\n기존 승인 범위와 현재 실행 내용이 달라져 재승인이 필요합니다.`,
    metadata: {
      ...(input.metadata ?? {}),
      approvalRefreshReason: "payload_hash_mismatch",
      previousApprovalId: check.approvalId,
      expectedPayloadHash: check.expectedPayloadHash,
      currentPayloadHash: check.currentPayloadHash,
    },
  });
}

function buildTaskPayload(task: TaskExecutionRow, ruleMemory: RuleMemoryHint | null): Record<string, unknown> {
  return {
    taskId: task.id,
    taskType: task.taskType,
    extractedFields: task.extractedFields,
    context: task.context,
    contextStatus: task.contextStatus,
    confidence: task.confidence,
    riskLevel: task.riskLevel,
    ruleMemory,
  };
}

function buildApprovalInput(
  task: TaskExecutionRow,
  intent: WorkIntentValue,
  connectorKey: string,
  action: string,
  ruleMemory: RuleMemoryHint | null,
  payload?: Record<string, unknown>,
  proposedCall?: { method: string; baseUrl: string; path: string },
): CreateApprovalRequestInput {
  const title = buildApprovalTitle(task, intent);
  const reason = buildApprovalReason(task, connectorKey, ruleMemory);
  const capability = INTENT_CAPABILITY[intent];
  const isWrite = isWriteCapability(capability);
  const approvalPayloadHash = buildConnectorApprovalPayloadHash({
    companyId: task.companyId,
    taskId: task.id,
    intent,
    capability,
    connectorKey,
    payload,
    proposedCall,
  });
  return {
    companyId: task.companyId,
    taskId: task.id,
    action,
    reason,
    title,
    description: reason,
    source: "connector_resolver",
    riskLevel: task.riskLevel,
    approvalPolicy: task.riskLevel === "high" ? "owner_only" : "approval_required",
    metadata: {
      actionType: action,
      connectorKey,
      intent,
      capability,
      confidence: task.confidence,
      reversible: isWrite ? isReversibleAction(action) : true,
      recipientKnown: isWrite ? hasKnownRecipient(task) : true,
      proposedCall,
      approvalScope: "exact_payload",
      approvalPayloadHash,
      approvalPayloadHashVersion: CONNECTOR_APPROVAL_PAYLOAD_HASH_VERSION,
      taskType: task.taskType,
      sourceType: "system",
      sourceSummary: String(task.extractedFields.summary ?? task.extractedFields.title ?? task.taskType),
      resultTitle: title,
      ruleMemory,
    },
  };
}

async function createConnectorSetupApproval(task: TaskExecutionRow, intent: WorkIntentValue, fallback: string) {
  const capability = INTENT_CAPABILITY[intent];
  return createApprovalRequest({
    companyId: task.companyId,
    taskId: task.id,
    action: "connector_setup_required",
    title: "커넥터 연결 필요",
    reason: `${capability} 작업을 처리할 커넥터가 아직 연결되지 않았습니다.`,
    description: `이 작업은 ${intent} 실행이 필요하지만 사용할 수 있는 연결이 없습니다. 설정에서 해당 업무 커넥터를 연결하거나 수동 처리로 전환하세요.`,
    source: "connector_resolver",
    riskLevel: "medium",
    approvalPolicy: "approval_required",
    metadata: {
      actionType: "connector_setup_required",
      intent,
      capability,
      fallback,
      taskType: task.taskType,
      sourceSummary: String(task.extractedFields.summary ?? task.taskType),
      resultTitle: "커넥터 연결 또는 수동 처리 선택",
      reversible: true,
      recipientKnown: true,
    },
  });
}

async function appendConnectorEvent(task: TaskExecutionRow, event: WorkEvent) {
  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    VALUES (
      ${task.companyId},
      'ai',
      ${`connector_${event.type}`},
      'task',
      ${task.id},
      ${JSON.stringify(event)}
    )
  `;
}

async function updateTaskExecutionState(taskId: string, status: string, metadata: Record<string, unknown>) {
  await sql`
    UPDATE tasks
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${taskId}
  `;
  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    SELECT company_id, 'ai', 'connector_execution_state_changed', 'task', id, ${JSON.stringify(metadata)}
    FROM tasks
    WHERE id = ${taskId}
  `;
}

async function loadRuleMemoryHint(taskId: string): Promise<RuleMemoryHint | null> {
  const rules = await findApplicableRulesForTask(taskId).catch(() => []);
  const first = rules[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  const ruleJson = asRecord(first.rule_json);
  return {
    id: String(first.id),
    effect: typeof ruleJson.effect === "string" ? ruleJson.effect : undefined,
    ruleText: typeof first.rule_text === "string" ? first.rule_text : undefined,
    confidence: typeof first.confidence === "number" ? first.confidence : Number(first.confidence ?? 0),
    ruleJson,
  };
}

function buildOfflineRuleRef(ruleMemory: RuleMemoryHint | null, profile?: MappingProfile): RuleRef {
  if (!ruleMemory?.ruleJson) {
    return {
      id: "no-rule",
      serverSafeFlag: false,
      connectorPath: true,
      idempotentWrite: Boolean(profile?.idempotency?.supported),
      approvalCount: 0,
    };
  }
  const evidence = asRecord(ruleMemory.ruleJson.evidence);
  const approvedCount = numberFromUnknown(
    ruleMemory.ruleJson.approvedCount
      ?? ruleMemory.ruleJson.approvalCount
      ?? evidence.approvedCount
      ?? evidence.total,
  );
  const consistency = numberFromUnknown(
    ruleMemory.ruleJson.consistency
      ?? ruleMemory.ruleJson.approvalRate
      ?? evidence.approvalRate,
  );
  const modificationRate = numberFromUnknown(
    ruleMemory.ruleJson.modificationRate
      ?? evidence.modificationRate
      ?? 0,
  );
  const explicitlyMarked = ruleMemory.ruleJson.offlineServerSafe === true
    || ruleMemory.ruleJson.serverSafeWhileDeviceOffline === true;

  return {
    id: ruleMemory.id,
    serverSafeFlag: explicitlyMarked && consistency >= 0.9 && modificationRate <= 0.1,
    connectorPath: true,
    idempotentWrite: Boolean(profile?.idempotency?.supported),
    approvalCount: approvedCount,
  };
}

function intentToAction(intent: WorkIntentValue): string {
  return {
    register_order: "create_order",
    confirm_order: "send_order_confirm",
    create_quote: "generate_quote",
    track_shipment: "track_shipment",
    read_inventory: "read_inventory",
    check_payment: "check_payment",
    confirm_with_staff: "create_staff_confirmation",
    read_inquiry: "read_inquiry",
    reply_inquiry: "send_reply",
    handle_complaint: "handle_complaint",
    create_report: "create_report",
    create_automation: "create_automation",
  }[intent];
}

function buildApprovalTitle(task: TaskExecutionRow, intent: WorkIntentValue) {
  const title = String(task.extractedFields.title ?? task.extractedFields.summary ?? "");
  const fallback = {
    register_order: "주문 등록 승인",
    confirm_order: "주문 확인 발송 승인",
    create_quote: "견적 생성 승인",
    track_shipment: "배송 상태 확인 승인",
    read_inventory: "재고 조회 승인",
    check_payment: "입금 확인 승인",
    confirm_with_staff: "직원 확인 요청 승인",
    read_inquiry: "문의 확인 승인",
    reply_inquiry: "문의 답변 승인",
    handle_complaint: "클레임 처리 승인",
    create_report: "보고서 생성 승인",
    create_automation: "자동화 초안 승인",
  }[intent];
  return title ? `${fallback}: ${title}` : fallback;
}

function buildApprovalReason(task: TaskExecutionRow, connectorKey: string, ruleMemory: RuleMemoryHint | null) {
  const parts = [
    `${connectorKey} 커넥터로 ${task.taskType} 작업을 실행하려 합니다.`,
    `위험도: ${task.riskLevel}, 신뢰도: ${Math.round(task.confidence * 100)}%`,
    task.contextStatus ? `회사 맥락 매칭: ${task.contextStatus}` : "",
    ruleMemory?.ruleText ? `적용 가능한 기존 규칙: ${ruleMemory.ruleText}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function mapWorkResultToTaskStatus(result: WorkResult, intent: WorkIntentValue) {
  if (result.status === "executed") {
    return result.result.ok ? "completed" : classifyConnectorFailureStatus(result.result, INTENT_CAPABILITY[intent]);
  }
  if (result.status === "needs_approval") return "waiting_approval";
  if (result.status === "blocked") return "blocked";
  if (result.status === "shadow") return "shadowed";
  return "pending";
}

function buildExecutionMetadata(result: WorkResult, intent: WorkIntentValue): Record<string, unknown> {
  if (result.status !== "executed" || result.result.ok) return { ...result, intent };
  const capability = INTENT_CAPABILITY[intent];
  const failureStatus = classifyConnectorFailureStatus(result.result, capability);
  const retryable = failureStatus === "retry_pending";
  return {
    ...result,
    intent,
    failurePolicy: {
      retryable,
      status: failureStatus,
      reason: failureReason(result.result.status, retryable, result.result.idempotency.supported, capability),
      suggestedDelayMs: retryable ? retryDelayMs(result.result.status) : null,
    },
  };
}

export function classifyConnectorFailureStatus(
  result: { status: number; idempotency?: { supported: boolean } },
  capability: Capability,
): "retry_pending" | "failed" | "connector_reauth_required" {
  if (result.status === 401 || result.status === 403) return "connector_reauth_required";
  if (result.status >= 400 && result.status < 500 && !isRetryableStatus(result.status)) return "failed";
  if (!isRetryableStatus(result.status)) return "failed";
  if (isWriteCapability(capability) && !result.idempotency?.supported) return "failed";
  return "retry_pending";
}

function isRetryableStatus(status: number) {
  return status === 0 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(status: number) {
  return status === 429 ? 60_000 : 15_000;
}

function failureReason(status: number, retryable: boolean, idempotencySupported: boolean, capability: Capability) {
  if (status === 401 || status === 403) return "커넥터 인증이 만료되었거나 권한이 부족합니다. 재연결이 필요합니다.";
  if (isWriteCapability(capability) && !idempotencySupported && isRetryableStatus(status)) {
    return "쓰기 커넥터가 멱등성을 지원하지 않아 자동 재시도를 막았습니다.";
  }
  return retryable ? "일시적인 커넥터 오류 또는 제한 응답입니다." : "커넥터가 요청을 거부했습니다.";
}

function isBlockedAction(action: string) {
  return ["refund", "payment_transfer", "transfer_money", "delete_order", "cancel_order"].includes(action);
}

function isReversibleAction(action: string) {
  return !["create_order", "send_order_confirm", "send_reply", "generate_quote"].includes(action);
}

function hasKnownRecipient(task: TaskExecutionRow) {
  const context = task.context;
  const customer = asRecord(context.customer);
  const fields = task.extractedFields;
  return Boolean(customer.id || fields.customerName || fields.sender || fields.customer);
}

function normalizeRisk(value: unknown): RiskLevel {
  const risk = String(value ?? "medium");
  if (risk === "low" || risk === "medium" || risk === "high") return risk;
  return "medium";
}

function redactCredentialRef(ref: string) {
  if (ref.startsWith("env:")) return `env:${ref.slice(4, 8)}***`;
  if (ref === "none" || ref === "manual") return ref;
  return `${ref.slice(0, 4)}***`;
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

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export type { MappingProfile, Capability };
export { listConnectorDefinitions };
