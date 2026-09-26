import type { InventoryContextRecord } from "../context/types.js";
import type { DecisionEngineInput, TaskDecisionResult, AlternativeItemSuggestion } from "./types.js";

const DEFAULT_AMOUNT_APPROVAL_THRESHOLD = 500_000;

export function decideTaskAction(input: DecisionEngineInput): TaskDecisionResult {
  const threshold = input.amountApprovalThreshold ?? DEFAULT_AMOUNT_APPROVAL_THRESHOLD;
  const fields = input.task.extractedFields;
  const riskLevel = String(input.task.riskLevel ?? "medium");
  const priority = normalizePriority(fields.priority);
  const dueDate = typeof fields.dueDate === "string" ? fields.dueDate : undefined;
  const amount = toNumber(fields.amount);
  const context = asRecord(input.context);
  const inventory = asRecord(context.inventory);
  const contextStatus = String(context.status ?? "not_applicable");
  const missingContext = Array.isArray(context.missingContext)
    ? context.missingContext.filter((item): item is string => typeof item === "string")
    : [];
  const ruleDecision = applyRuleMemory(input.ruleMemory ?? []);

  if (isBlockedText(fields)) {
    return buildDecision({
      outcome: "BLOCKED",
      action: "blocked_sensitive_action",
      title: "차단된 업무",
      reason: "환불, 송금, 주문 취소처럼 초기 자동화 범위에서 금지된 업무입니다.",
      priority,
      dueDate,
      riskLevel: "high",
      evidence: ["금지 키워드 감지"],
    });
  }

  if (ruleDecision === "approval_required") {
    return buildDecision({
      outcome: "APPROVAL_REQUIRED",
      action: actionForTask(input.task.taskType),
      title: "회사 규칙에 따른 승인 필요",
      reason: "이전 승인/반려 이력에서 같은 맥락은 승인 후 처리하도록 학습된 업무입니다.",
      priority,
      dueDate,
      riskLevel,
      evidence: ["rule_memory: approval_required_when_same_context"],
    });
  }

  if (amount !== undefined && amount >= threshold) {
    return buildDecision({
      outcome: "APPROVAL_REQUIRED",
      action: actionForTask(input.task.taskType),
      title: "금액 기준 승인 필요",
      reason: `금액 ${amount.toLocaleString("ko-KR")}원이 승인 기준 ${threshold.toLocaleString("ko-KR")}원 이상입니다.`,
      priority,
      dueDate,
      riskLevel: "high",
      evidence: [`amount=${amount}`, `threshold=${threshold}`],
    });
  }

  if (riskLevel === "high" || riskLevel === "uncertain") {
    return buildDecision({
      outcome: "APPROVAL_REQUIRED",
      action: actionForTask(input.task.taskType),
      title: "위험도 기준 승인 필요",
      reason: `위험도 ${riskLevel} 업무는 자동 실행하지 않고 승인함에 올립니다.`,
      priority,
      dueDate,
      riskLevel,
      evidence: [`riskLevel=${riskLevel}`],
    });
  }

  if (contextStatus !== "matched" || missingContext.length > 0) {
    return buildDecision({
      outcome: "APPROVAL_REQUIRED",
      action: actionForTask(input.task.taskType),
      title: "맥락 정보 확인 필요",
      reason: missingContext.length
        ? `확인되지 않은 회사 정보가 있습니다: ${missingContext.join(", ")}`
        : "거래처, 품목 또는 재고 맥락이 확정되지 않았습니다.",
      priority,
      dueDate,
      riskLevel,
      evidence: [`contextStatus=${contextStatus}`, ...missingContext],
    });
  }

  if (input.task.taskType === "order_request" || input.task.taskType === "quote_request") {
    const inventoryStatus = String(inventory.status ?? "unknown");
    if (inventoryStatus === "shortage" || inventoryStatus === "low_stock") {
      const alternatives = suggestAlternativeItems(input, inventoryStatus);
      return buildDecision({
        outcome: alternatives.length ? "SUGGEST_ALTERNATIVE" : "APPROVAL_REQUIRED",
        action: "suggest_alternative_item",
        title: alternatives.length ? "재고 부족 대체상품 추천" : "재고 부족 승인 필요",
        reason: alternatives.length
          ? "요청 품목 재고가 부족해 즉시 처리 가능한 대체 품목을 추천합니다."
          : "요청 품목 재고가 부족하지만 추천할 대체 품목이 없습니다.",
        priority,
        dueDate,
        riskLevel: "medium",
        alternatives,
        evidence: [`inventoryStatus=${inventoryStatus}`],
      });
    }
  }

  if (ruleDecision === "auto_allowed" || canAutoRun(input.task.taskType)) {
    return buildDecision({
      outcome: "AUTO_RUN",
      action: actionForTask(input.task.taskType),
      title: "자동 실행 가능",
      reason: "거래처, 품목, 재고 맥락이 확인되었고 금액/위험도 기준을 넘지 않았습니다.",
      priority,
      dueDate,
      riskLevel,
      evidence: ["context matched", "policy clear"],
    });
  }

  return buildDecision({
    outcome: "MANUAL_REVIEW",
    action: actionForTask(input.task.taskType),
    title: "검토 필요",
    reason: "아직 자동 실행 능력에 매핑되지 않은 업무 유형입니다.",
    priority,
    dueDate,
    riskLevel,
    evidence: [`taskType=${input.task.taskType}`],
  });
}

function suggestAlternativeItems(
  input: DecisionEngineInput,
  inventoryStatus: string,
): AlternativeItemSuggestion[] {
  if (!input.catalog) return [];
  const requestedItemId = String(asRecord(input.context).item ? asRecord(asRecord(input.context).item).id ?? "" : "");
  const requestedQty = Math.max(1, toNumber(input.task.extractedFields.quantity) ?? 1);
  const inventoryByItem = new Map<string, InventoryContextRecord>(
    input.catalog.inventory.map((row) => [row.itemId, row]),
  );

  return input.catalog.items
    .filter((item) => item.id !== requestedItemId)
    .map((item) => {
      const stock = inventoryByItem.get(item.id);
      const availableToPromise = Math.max(0, (stock?.quantity ?? 0) - (stock?.safetyQuantity ?? 0));
      return { item, availableToPromise };
    })
    .filter(({ availableToPromise }) => availableToPromise >= requestedQty)
    .slice(0, 3)
    .map(({ item, availableToPromise }) => ({
      itemId: item.id,
      itemName: item.name,
      availableToPromise,
      reason: `${inventoryStatus} 상황에서 요청 수량 ${requestedQty}개 이상 처리 가능한 품목입니다.`,
    }));
}

function canAutoRun(taskType: string) {
  return taskType === "order_request" || taskType === "delivery_inquiry";
}

function actionForTask(taskType: string) {
  const actions: Record<string, string> = {
    order_request: "create_order",
    quote_request: "create_quote",
    delivery_inquiry: "send_delivery_reply",
    payment_report: "verify_payment",
    reply_draft: "draft_reply",
    complaint: "draft_complaint_reply",
    automation_request: "draft_automation",
    report_request: "create_report",
    inventory_inquiry: "check_inventory",
    invoice_request: "draft_invoice_request",
    return_exchange: "draft_return_exchange",
    order_update: "update_order",
    data_update: "update_master_data",
  };
  return actions[taskType] ?? "manual_review";
}

function applyRuleMemory(rules: Array<Record<string, unknown>>) {
  for (const rule of rules) {
    const ruleJson = asRecord(rule.rule_json);
    const effect = String(ruleJson.effect ?? "");
    if (effect === "require_review_when_same_context" || effect === "approval_required_when_same_context") {
      return "approval_required";
    }
    if (effect === "auto_allowed_when_same_context") return "auto_allowed";
  }
  return "none";
}

function buildDecision(input: {
  outcome: TaskDecisionResult["outcome"];
  action: string;
  title: string;
  reason: string;
  priority: TaskDecisionResult["priority"];
  dueDate?: string;
  riskLevel: string;
  alternatives?: AlternativeItemSuggestion[];
  evidence: string[];
}): TaskDecisionResult {
  return {
    outcome: input.outcome,
    action: input.action,
    title: input.title,
    reason: input.reason,
    approvalAction: input.outcome === "APPROVAL_REQUIRED" || input.outcome === "SUGGEST_ALTERNATIVE"
      ? input.action
      : undefined,
    priority: input.priority,
    dueDate: input.dueDate,
    riskLevel: input.riskLevel,
    suggestedAlternatives: input.alternatives ?? [],
    evidence: input.evidence,
    decidedAt: new Date().toISOString(),
  };
}

function isBlockedText(fields: Record<string, unknown>) {
  const text = [
    fields.title,
    fields.summary,
    fields.recommendedAction,
  ].filter(Boolean).join(" ");
  return /환불|송금|이체|주문\s*취소|계약\s*확정/.test(text);
}

function normalizePriority(value: unknown): TaskDecisionResult["priority"] {
  if (value === "low" || value === "normal" || value === "high" || value === "urgent") return value;
  return "normal";
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
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
