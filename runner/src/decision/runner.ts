import { createApprovalRequest } from "../approvals/store.js";
import { evaluateTaskAutonomy, type UnifiedGateDecision } from "../autonomyGate/decisionGate.js";
import { runAutonomyGateForCreateInput } from "../autonomyGate/runtime.js";
import type { RiskLevel } from "../autonomyGate/types.js";
import { INTENT_CAPABILITY, type WorkIntent } from "../connectors/connectorResolver.js";
import { getCompanyDeviceOperationStatus } from "../devices/store.js";
import { loadCompanyContextCatalog, taskRowToContextInput } from "../context/store.js";
import { isDatabaseConfigured, sql } from "../db/client.js";
import { findApplicableRulesForTask } from "../memory/ruleMemory.js";
import { decideTaskAction } from "./engine.js";
import type { TaskDecisionResult } from "./types.js";

export async function decideAndStoreTask(taskId: string) {
  if (!isDatabaseConfigured()) {
    throw new Error("Decision Engine requires DATABASE_URL because it writes task decision state.");
  }

  const rows = await sql`
    SELECT
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
      created_at,
      updated_at
    FROM tasks
    WHERE id = ${taskId}
    LIMIT 1
  `;
  if (rows.length === 0) throw new Error(`Task not found: ${taskId}`);

  const row = rows[0];
  const task = taskRowToContextInput(row);
  const catalog = await loadCompanyContextCatalog(task.companyId);
  const ruleMemory = await findApplicableRulesForTask(taskId).catch(() => []);
  const decision = decideTaskAction({
    task,
    context: asRecord(row.context_json),
    catalog,
    ruleMemory: ruleMemory.map((rule: unknown) => asRecord(rule)),
    amountApprovalThreshold: Number(process.env.DECISION_AMOUNT_APPROVAL_THRESHOLD ?? 500_000),
  });
  const autonomyGate = await decideTaskAutonomy({
    taskId,
    companyId: String(row.company_id),
    taskType: String(row.task_type),
    confidence: Number(row.confidence ?? 0),
    riskLevel: normalizeRisk(String(row.risk_level ?? decision.riskLevel)),
    decision,
    ruleMemory: ruleMemory.map((rule: unknown) => asRecord(rule)),
  });

  const saved = await saveTaskDecision(taskId, String(row.company_id), decision, autonomyGate);
  const approval = await maybeCreateDecisionApproval(String(row.company_id), taskId, decision, autonomyGate);
  await recordAutonomyDecided(String(row.company_id), taskId, decision, autonomyGate);

  return { task, decision, autonomyGate, saved, approval };
}

async function decideTaskAutonomy(input: {
  taskId: string;
  companyId: string;
  taskType: string;
  confidence: number;
  riskLevel: RiskLevel;
  decision: TaskDecisionResult;
  ruleMemory: Array<Record<string, unknown>>;
}): Promise<UnifiedGateDecision> {
  const intent = mapTaskTypeToIntent(input.taskType);
  const capability = INTENT_CAPABILITY[intent];
  const firstRule = input.ruleMemory[0];
  const ruleJson = firstRule ? asRecord(firstRule.rule_json) : {};
  const deviceStatus = await getCompanyDeviceOperationStatus({ companyId: input.companyId }).catch(() => null);
  const gate = await runAutonomyGateForCreateInput({
    companyId: input.companyId,
    taskId: input.taskId,
    action: input.decision.action,
    reason: input.decision.reason,
    title: input.decision.title,
    source: "decision_engine",
    riskLevel: input.riskLevel,
    approvalPolicy: input.riskLevel === "high" ? "owner_only" : "approval_required",
    metadata: {
      actionType: input.decision.action,
      confidence: input.confidence,
      reversible: input.decision.outcome !== "BLOCKED",
      recipientKnown: true,
      taskType: input.taskType,
      intent,
      capability,
      sourceType: "decision_engine",
      resultTitle: input.decision.title,
      resultContent: input.decision.reason,
    },
  });

  if (input.decision.outcome === "BLOCKED") {
    return {
      decision: "BLOCK",
      reason: input.decision.reason,
      gateMode: gate.mode,
      gateEffectiveOutcome: gate.effectiveOutcome,
      blockedBy: "decision_engine_blocked",
      writeCapability: true,
    };
  }

  return evaluateTaskAutonomy({
    capability,
    riskLevel: input.riskLevel,
    ruleEffect: typeof ruleJson.effect === "string" ? ruleJson.effect : undefined,
    ruleText: typeof firstRule?.rule_text === "string" ? firstRule.rule_text : undefined,
    rule: {
      id: String(firstRule?.id ?? "no-rule"),
      serverSafeFlag: false,
      connectorPath: true,
      idempotentWrite: false,
      approvalCount: numberFromUnknown(ruleJson.approvedCount ?? ruleJson.approvalCount),
    },
    deviceMode: deviceStatus?.mode ?? "OFFLINE",
    gate,
  });
}

async function saveTaskDecision(
  taskId: string,
  companyId: string,
  decision: TaskDecisionResult,
  autonomyGate: UnifiedGateDecision,
) {
  const status = statusForDecision(decision, autonomyGate);
  const rows = await sql`
    UPDATE tasks
    SET
      status = ${status},
      extracted_fields_json = COALESCE(extracted_fields_json, '{}'::jsonb) || ${JSON.stringify({ decision, autonomyGate })}::jsonb,
      updated_at = NOW()
    WHERE id = ${taskId}
    RETURNING id, company_id, task_type, status, extracted_fields_json, context_status, due_at, updated_at
  `;

  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    VALUES (
      ${companyId},
      'ai',
      'task_decision_made',
      'task',
      ${taskId},
      ${JSON.stringify(decision)}
    )
  `;

  return rows[0];
}

async function maybeCreateDecisionApproval(
  companyId: string,
  taskId: string,
  decision: TaskDecisionResult,
  autonomyGate: UnifiedGateDecision,
) {
  if (
    decision.outcome !== "APPROVAL_REQUIRED" &&
    decision.outcome !== "SUGGEST_ALTERNATIVE" &&
    autonomyGate.decision !== "ASSIST"
  ) {
    return null;
  }

  return await createApprovalRequest({
    companyId,
    taskId,
    action: decision.approvalAction ?? decision.action,
    title: decision.title,
    reason: decision.reason,
    description: [
      decision.reason,
      decision.suggestedAlternatives.length
        ? `추천 대체상품: ${decision.suggestedAlternatives.map((item) => item.itemName).join(", ")}`
        : "",
    ].filter(Boolean).join("\n"),
    source: "decision_engine",
    riskLevel: normalizeRiskForApproval(decision.riskLevel),
    approvalPolicy: decision.riskLevel === "high" ? "owner_only" : "approval_required",
    metadata: {
      decision,
      autonomyGate,
      priority: decision.priority,
      dueDate: decision.dueDate,
      resultTitle: decision.title,
      resultContent: decision.reason,
    },
  });
}

async function recordAutonomyDecided(
  companyId: string,
  taskId: string,
  decision: TaskDecisionResult,
  autonomyGate: UnifiedGateDecision,
) {
  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    VALUES (
      ${companyId},
      'ai',
      'AutonomyDecided',
      'task',
      ${taskId},
      ${JSON.stringify({ decision, autonomyGate })}
    )
  `;
}

function statusForDecision(decision: TaskDecisionResult, autonomyGate: UnifiedGateDecision) {
  if (decision.outcome === "BLOCKED" || autonomyGate.decision === "BLOCK") return "blocked";
  if (autonomyGate.decision === "SHADOW") return "shadowed";
  if (autonomyGate.decision === "ASSIST") return "approval_required";
  if (decision.outcome === "AUTO_RUN" && autonomyGate.decision === "AUTO") return "ready_to_execute";
  if (decision.outcome === "SUGGEST_ALTERNATIVE") return "approval_required";
  if (decision.outcome === "APPROVAL_REQUIRED") return "approval_required";
  return "needs_review";
}

function mapTaskTypeToIntent(taskType: string): WorkIntent {
  if (taskType === "order_request") return "register_order";
  if (taskType === "quote_request") return "create_quote";
  if (taskType === "inventory_check" || taskType === "inventory_inquiry") return "read_inventory";
  if (taskType === "delivery_inquiry") return "track_shipment";
  if (taskType === "payment_report") return "check_payment";
  if (taskType === "complaint") return "handle_complaint";
  if (taskType === "report_request") return "create_report";
  if (taskType === "automation_request") return "create_automation";
  if (taskType === "reply_draft") return "reply_inquiry";
  return "reply_inquiry";
}

function normalizeRiskForApproval(value: string): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "medium";
}

function normalizeRisk(value: string): RiskLevel {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "medium";
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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
