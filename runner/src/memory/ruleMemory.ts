// memory/ruleMemory.ts
// 승인/반려 결과를 회사별 rule_memory에 저장하고 다음 정책 판단에서 읽을 수 있게 한다.

import { createHash } from "node:crypto";
import { sql } from "../db/client.js";
import { DEFAULT_COMPANY_ID } from "../intake/config.js";

export type RuleEffect =
  | "auto_allowed_when_same_context"
  | "approval_required_when_same_context"
  | "require_review_when_same_context";

export interface ApprovalDecisionRuleInput {
  approvalId: string;
  decision: "approved" | "rejected";
  resolvedBy?: string;
  note?: string;
}

export async function saveRuleFromApprovalDecision(input: ApprovalDecisionRuleInput) {
  const rows = await sql`
    SELECT
      ar.id AS approval_id,
      ar.company_id,
      ar.task_id,
      ar.title,
      ar.description,
      ar.options_json,
      ar.status,
      ar.selected_option,
      ar.resolved_by,
      ar.resolved_at,
      t.task_type,
      t.extracted_fields_json,
      t.context_json,
      t.context_status,
      t.risk_level,
      t.confidence
    FROM approval_requests ar
    LEFT JOIN tasks t ON t.id = ar.task_id
    WHERE ar.id = ${input.approvalId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new Error(`Approval request not found for rule memory: ${input.approvalId}`);
  }

  const row = rows[0];
  const options = asRecord(row.options_json);
  const metadata = asRecord(options.metadata);
  const context = asRecord(row.context_json);
  const extracted = asRecord(row.extracted_fields_json);
  const taskType = String(row.task_type ?? metadata.taskType ?? "manual_request");
  const action = String(options.action ?? metadata.action ?? "unknown_action");
  const riskLevel = String(row.risk_level ?? metadata.riskLevel ?? "medium");
  const effect = decideRuleEffect(input.decision, action, riskLevel);
  const scope = buildRuleScope(taskType, context);
  const ruleId = buildRuleId({
    companyId: String(row.company_id),
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    action,
    effect,
  });
  const existingRules = await sql`
    SELECT rule_json
    FROM rule_memory
    WHERE id = ${ruleId}
    LIMIT 1
  `;
  const existingRuleJson = asRecord(existingRules[0]?.rule_json);
  const previousEvidence = asRecord(existingRuleJson.evidence);
  const previousApprovedCount = numberFromUnknown(
    existingRuleJson.approvedCount ?? existingRuleJson.approvalCount ?? previousEvidence.approvedCount,
  );
  const previousRejectedCount = numberFromUnknown(
    existingRuleJson.rejectedCount ?? previousEvidence.rejectedCount,
  );
  const previousModificationCount = numberFromUnknown(
    existingRuleJson.modificationCount ?? previousEvidence.modificationCount,
  );
  const approvedCount = previousApprovedCount + (input.decision === "approved" ? 1 : 0);
  const rejectedCount = previousRejectedCount + (input.decision === "rejected" ? 1 : 0);
  const totalCount = approvedCount + rejectedCount;
  const approvalRate = totalCount > 0 ? approvedCount / totalCount : 0;
  const modificationRate = totalCount > 0 ? previousModificationCount / totalCount : 0;
  const existingOfflineServerSafe = existingRuleJson.offlineServerSafe === true
    || existingRuleJson.serverSafeWhileDeviceOffline === true;

  const ruleJson = {
    ...existingRuleJson,
    source: "approval_decision",
    sourceApprovalId: input.approvalId,
    decision: input.decision,
    effect,
    action,
    taskId: row.task_id ? String(row.task_id) : undefined,
    taskType,
    riskLevel,
    autoProcessEligible: effect === "auto_allowed_when_same_context",
    requiresApproval: effect !== "auto_allowed_when_same_context",
    approvedCount,
    approvalCount: approvedCount,
    rejectedCount,
    totalCount,
    consistency: approvalRate,
    approvalRate,
    modificationCount: previousModificationCount,
    modificationRate,
    offlineServerSafe: existingOfflineServerSafe,
    serverSafeWhileDeviceOffline: existingOfflineServerSafe,
    evidence: {
      ...previousEvidence,
      approvedCount,
      rejectedCount,
      total: totalCount,
      approvalRate,
      modificationCount: previousModificationCount,
      modificationRate,
    },
    matchedContext: {
      customer: pickContextEntity(context.customer),
      item: pickContextEntity(context.item),
      inventory: asRecord(context.inventory),
      contextStatus: row.context_status ? String(row.context_status) : undefined,
      contextConfidence: typeof context.contextConfidence === "number" ? context.contextConfidence : undefined,
    },
    extractedFields: {
      customerName: extracted.customerName,
      itemName: extracted.itemName,
      quantity: extracted.quantity,
      amount: extracted.amount,
      dueDateText: extracted.dueDateText,
    },
    approvedBy: input.resolvedBy ?? row.resolved_by ?? "owner",
    note: input.note,
    learnedAt: new Date().toISOString(),
  };

  const ruleText = buildRuleText({
    decision: input.decision,
    action,
    taskType,
    riskLevel,
    effect,
    context,
  });

  const saved = await sql`
    INSERT INTO rule_memory (
      id,
      company_id,
      scope_type,
      scope_id,
      rule_text,
      rule_json,
      confidence,
      status,
      updated_at
    )
    VALUES (
      ${ruleId},
      ${String(row.company_id)},
      ${scope.scopeType},
      ${scope.scopeId},
      ${ruleText},
      ${JSON.stringify(ruleJson)},
      ${input.decision === "approved" ? 0.86 : 0.78},
      'active',
      NOW()
    )
    ON CONFLICT (id)
    DO UPDATE SET
      rule_text = EXCLUDED.rule_text,
      rule_json = EXCLUDED.rule_json,
      confidence = EXCLUDED.confidence,
      status = 'active',
      updated_at = NOW()
    RETURNING id, company_id, scope_type, scope_id, rule_text, rule_json, confidence, status, created_at, updated_at
  `;

  await sql`
    INSERT INTO audit_logs (company_id, actor_type, actor_id, action, target_type, target_id, metadata_json)
    VALUES (
      ${String(row.company_id)},
      'ai',
      'rule-memory',
      'approval_decision_saved_as_rule',
      'rule_memory',
      ${ruleId},
      ${JSON.stringify({
        approvalId: input.approvalId,
        decision: input.decision,
        effect,
        action,
        taskType,
        scope,
      })}
    )
  `;

  return saved[0];
}

export async function setRuleOfflineServerSafe(input: {
  ruleId: string;
  enabled: boolean;
  actorId?: string;
}) {
  const rows = await sql`
    SELECT id, company_id, rule_json
    FROM rule_memory
    WHERE id = ${input.ruleId}
    LIMIT 1
  `;
  if (rows.length === 0) {
    throw new Error(`Rule not found: ${input.ruleId}`);
  }

  const row = rows[0];
  const currentJson = asRecord(row.rule_json);
  const updatedJson: Record<string, unknown> = {
    ...currentJson,
    offlineServerSafe: input.enabled,
    serverSafeWhileDeviceOffline: input.enabled,
    offlineServerSafeUpdatedBy: input.actorId ?? "owner",
    offlineServerSafeUpdatedAt: new Date().toISOString(),
  };

  const updated = await sql`
    UPDATE rule_memory
    SET rule_json = ${JSON.stringify(updatedJson)},
        updated_at = NOW()
    WHERE id = ${input.ruleId}
    RETURNING id, company_id, scope_type, scope_id, rule_text, rule_json, confidence, status, created_at, updated_at
  `;

  await sql`
    INSERT INTO audit_logs (company_id, actor_type, actor_id, action, target_type, target_id, metadata_json)
    VALUES (
      ${String(row.company_id)},
      'user',
      ${input.actorId ?? "owner"},
      ${input.enabled ? "rule_offline_server_safe_enabled" : "rule_offline_server_safe_disabled"},
      'rule_memory',
      ${input.ruleId},
      ${JSON.stringify({
        enabled: input.enabled,
        approvedCount: updatedJson.approvedCount ?? updatedJson.approvalCount,
        approvalRate: updatedJson.approvalRate,
        modificationRate: updatedJson.modificationRate,
      })}
    )
  `;

  return updated[0];
}

export async function listRuleMemory(input: {
  companyId?: string;
  scopeType?: string;
  scopeId?: string;
  status?: string;
  limit?: number;
}) {
  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  const status = input.status ?? "active";
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  if (input.scopeType && input.scopeId) {
    return await sql`
      SELECT id, company_id, scope_type, scope_id, rule_text, rule_json, confidence, status, created_at, updated_at
      FROM rule_memory
      WHERE company_id = ${companyId}
        AND status = ${status}
        AND scope_type = ${input.scopeType}
        AND scope_id = ${input.scopeId}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
  }

  if (input.scopeType) {
    return await sql`
      SELECT id, company_id, scope_type, scope_id, rule_text, rule_json, confidence, status, created_at, updated_at
      FROM rule_memory
      WHERE company_id = ${companyId}
        AND status = ${status}
        AND scope_type = ${input.scopeType}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
  }

  return await sql`
    SELECT id, company_id, scope_type, scope_id, rule_text, rule_json, confidence, status, created_at, updated_at
    FROM rule_memory
    WHERE company_id = ${companyId}
      AND status = ${status}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
}

export async function findApplicableRulesForTask(taskId: string) {
  const rows = await sql`
    SELECT id, company_id, task_type, context_json
    FROM tasks
    WHERE id = ${taskId}
    LIMIT 1
  `;
  if (rows.length === 0) throw new Error(`Task not found: ${taskId}`);

  const task = rows[0];
  const context = asRecord(task.context_json);
  const scopes = buildApplicableScopes(String(task.task_type), context);

  if (scopes.length === 0) return [];

  const companyId = String(task.company_id);
  const rules = await sql`
    SELECT id, company_id, scope_type, scope_id, rule_text, rule_json, confidence, status, created_at, updated_at
    FROM rule_memory
    WHERE company_id = ${companyId}
      AND status = 'active'
      AND (
        ${scopes.map((scope) => `${scope.scopeType}:${scope.scopeId}`).join("|")} LIKE '%' || scope_type || ':' || COALESCE(scope_id, '') || '%'
      )
    ORDER BY confidence DESC, updated_at DESC
    LIMIT 20
  `;

  return rules;
}

function decideRuleEffect(decision: "approved" | "rejected", action: string, riskLevel: string): RuleEffect {
  if (decision === "rejected") return "require_review_when_same_context";
  if (riskLevel === "high" || isSensitiveAction(action)) return "approval_required_when_same_context";
  return "auto_allowed_when_same_context";
}

function isSensitiveAction(action: string) {
  const normalized = action.toLowerCase();
  return [
    "store_session_cookie",
    "use_saved_session",
    "payment",
    "refund",
    "transfer",
    "delete",
    "cancel",
  ].some((word) => normalized.includes(word));
}

function buildRuleScope(taskType: string, context: Record<string, unknown>) {
  const customer = asRecord(context.customer);
  const item = asRecord(context.item);

  if (customer.id && item.id) {
    return { scopeType: "customer_item_task", scopeId: `${String(customer.id)}:${String(item.id)}:${taskType}` };
  }
  if (customer.id) {
    return { scopeType: "customer_task", scopeId: `${String(customer.id)}:${taskType}` };
  }
  if (item.id) {
    return { scopeType: "item_task", scopeId: `${String(item.id)}:${taskType}` };
  }
  return { scopeType: "task_type", scopeId: taskType };
}

function buildApplicableScopes(taskType: string, context: Record<string, unknown>) {
  const customer = asRecord(context.customer);
  const item = asRecord(context.item);
  const scopes: Array<{ scopeType: string; scopeId: string }> = [{ scopeType: "task_type", scopeId: taskType }];

  if (item.id) scopes.unshift({ scopeType: "item_task", scopeId: `${String(item.id)}:${taskType}` });
  if (customer.id) scopes.unshift({ scopeType: "customer_task", scopeId: `${String(customer.id)}:${taskType}` });
  if (customer.id && item.id) {
    scopes.unshift({ scopeType: "customer_item_task", scopeId: `${String(customer.id)}:${String(item.id)}:${taskType}` });
  }

  return scopes;
}

function buildRuleId(input: {
  companyId: string;
  scopeType: string;
  scopeId: string;
  action: string;
  effect: RuleEffect;
}) {
  const hash = createHash("sha256")
    .update(`${input.companyId}|${input.scopeType}|${input.scopeId}|${input.action}|${input.effect}`)
    .digest("hex")
    .slice(0, 24);
  return `rule_${hash}`;
}

function buildRuleText(input: {
  decision: "approved" | "rejected";
  action: string;
  taskType: string;
  riskLevel: string;
  effect: RuleEffect;
  context: Record<string, unknown>;
}) {
  const customer = asRecord(input.context.customer);
  const item = asRecord(input.context.item);
  const subject = [
    customer.name ? `거래처 ${String(customer.name)}` : "",
    item.name ? `품목 ${String(item.name)}` : "",
    `업무 ${input.taskType}`,
  ].filter(Boolean).join(" · ");

  if (input.effect === "auto_allowed_when_same_context") {
    return `대표가 승인한 기준: ${subject}에서 ${input.action} 처리는 같은 조건이면 자동 처리 후보로 사용한다.`;
  }
  if (input.effect === "approval_required_when_same_context") {
    return `대표가 승인했지만 보수 적용: ${subject}에서 ${input.action} 처리는 같은 조건이어도 승인 후 처리한다.`;
  }
  return `대표가 반려한 기준: ${subject}에서 ${input.action} 처리는 같은 조건이면 자동 처리하지 말고 재검토한다.`;
}

function pickContextEntity(value: unknown) {
  const entity = asRecord(value);
  return {
    id: entity.id,
    name: entity.name,
    score: entity.score,
    kind: entity.kind,
  };
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
