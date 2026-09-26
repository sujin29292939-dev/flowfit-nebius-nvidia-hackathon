// context/engine.ts
// 업무 후보를 회사의 거래처/품목/재고 맥락과 매칭한다.

import { matchEntity, notNeededMatch } from "./matcher.js";
import type {
  CompanyContextResult,
  ContextEngineInput,
  EntityContextMatch,
  InventoryContextMatch,
  InventoryStatus,
} from "./types.js";

export function matchCompanyContext(input: ContextEngineInput): CompanyContextResult {
  const { task, catalog } = input;
  const fields = task.extractedFields;

  const customer = shouldMatchCustomer(task.taskType, fields)
    ? matchEntity(asString(fields.customerName), catalog.customers)
    : notNeededMatch("주문번호 또는 송장번호로 조회 가능한 업무");

  const item = shouldMatchItem(task.taskType, fields)
    ? matchEntity(asString(fields.itemName), catalog.items)
    : notNeededMatch("품목 매칭이 필요하지 않은 업무");

  const inventory = buildInventoryMatch(task.taskType, item, catalog.inventory, Number(fields.quantity ?? 0));
  const missingContext = collectMissingContext(task.taskType, fields, customer, item, inventory);
  const contextConfidence = calculateContextConfidence(customer, item, inventory);
  const decisionHints = buildDecisionHints(task.taskType, customer, item, inventory, missingContext);
  const status = missingContext.length > 0 ? "needs_review" : task.taskType === "unknown" ? "needs_review" : "matched";

  return {
    taskId: task.id,
    companyId: task.companyId,
    taskType: task.taskType,
    status,
    contextConfidence,
    customer,
    item,
    inventory,
    missingContext,
    decisionHints,
    recommendedAction: recommendAction(task.taskType, missingContext, inventory),
    matchedAt: new Date().toISOString(),
  };
}

function shouldMatchCustomer(taskType: string, fields: Record<string, unknown>) {
  if (taskType === "delivery_inquiry") {
    return !fields.orderNumber && !fields.trackingNumber;
  }
  return taskType !== "unknown";
}

function shouldMatchItem(taskType: string, fields: Record<string, unknown>) {
  return ["order_request", "quote_request"].includes(taskType) && !!fields.itemName;
}

function buildInventoryMatch(
  taskType: string,
  item: EntityContextMatch,
  inventoryRows: Array<{ itemId: string; quantity: number; safetyQuantity: number }>,
  requestedQuantity: number,
): InventoryContextMatch {
  if (taskType !== "order_request") {
    return {
      status: "not_applicable",
      reason: "주문 등록 업무가 아니므로 재고 판단 생략",
    };
  }

  if (!item.id) {
    return {
      status: "unknown",
      requestedQuantity: requestedQuantity || undefined,
      reason: "품목 매칭 전이라 재고를 확인할 수 없음",
    };
  }

  const row = inventoryRows.find((candidate) => candidate.itemId === item.id);
  if (!row) {
    return {
      status: "unknown",
      itemId: item.id,
      itemName: item.name,
      requestedQuantity: requestedQuantity || undefined,
      reason: "해당 품목의 재고 기록 없음",
    };
  }

  const availableToPromise = row.quantity - row.safetyQuantity;
  const shortageQuantity = Math.max(0, requestedQuantity - availableToPromise);
  const status: InventoryStatus =
    !requestedQuantity ? "unknown" :
    shortageQuantity > 0 ? "shortage" :
    availableToPromise === requestedQuantity ? "low_stock" :
    "enough";

  return {
    status,
    itemId: item.id,
    itemName: item.name,
    requestedQuantity: requestedQuantity || undefined,
    quantity: row.quantity,
    safetyQuantity: row.safetyQuantity,
    availableToPromise,
    shortageQuantity,
    reason: inventoryReason(status, shortageQuantity),
  };
}

function collectMissingContext(
  taskType: string,
  fields: Record<string, unknown>,
  customer: EntityContextMatch,
  item: EntityContextMatch,
  inventory: InventoryContextMatch,
) {
  const missing: string[] = [];

  if (taskType === "unknown") {
    missing.push("업무 유형");
    return missing;
  }

  if (customer.kind === "not_found") {
    missing.push("거래처 매칭");
  }

  if (["order_request", "quote_request"].includes(taskType)) {
    if (!fields.itemName) missing.push("품목명");
    else if (item.kind === "not_found") missing.push("품목 매칭");
  }

  if (taskType === "order_request") {
    if (!fields.quantity) missing.push("수량");
    if (inventory.status === "unknown") missing.push("재고 정보");
    if (inventory.status === "shortage") missing.push("재고 부족");
  }

  if (taskType === "payment_report" && !fields.amount) {
    missing.push("입금 금액");
  }

  if (taskType === "delivery_inquiry" && customer.kind === "not_found" && !fields.orderNumber && !fields.trackingNumber) {
    missing.push("거래처명 또는 주문/송장번호");
  }

  return [...new Set(missing)];
}

function calculateContextConfidence(
  customer: EntityContextMatch,
  item: EntityContextMatch,
  inventory: InventoryContextMatch,
) {
  const scores = [customer, item]
    .filter((entry) => entry.kind !== "not_needed")
    .map((entry) => entry.score);

  if (inventory.status === "enough") scores.push(0.95);
  if (inventory.status === "low_stock") scores.push(0.82);
  if (inventory.status === "shortage") scores.push(0.65);
  if (inventory.status === "unknown") scores.push(0.45);

  if (scores.length === 0) return 1;
  const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Number(Math.max(0, Math.min(1, avg)).toFixed(2));
}

function buildDecisionHints(
  taskType: string,
  customer: EntityContextMatch,
  item: EntityContextMatch,
  inventory: InventoryContextMatch,
  missingContext: string[],
) {
  const hints: string[] = [];

  if (customer.id) hints.push(`거래처: ${customer.name} (${Math.round(customer.score * 100)}%)`);
  if (item.id) hints.push(`품목: ${item.name} (${Math.round(item.score * 100)}%)`);
  if (inventory.status === "enough") hints.push(`재고 가능: 요청 ${inventory.requestedQuantity}, 가능 ${inventory.availableToPromise}`);
  if (inventory.status === "low_stock") hints.push("요청 수량 처리 후 안전재고에 근접");
  if (inventory.status === "shortage") hints.push(`재고 부족: ${inventory.shortageQuantity}개 부족`);
  if (taskType === "payment_report") hints.push("입금 업무는 자동 확정하지 말고 읽기/매칭 후 관리자 확인");
  if (missingContext.length > 0) hints.push(`확인 필요: ${missingContext.join(", ")}`);

  return hints;
}

function recommendAction(taskType: string, missingContext: string[], inventory: InventoryContextMatch) {
  if (missingContext.length > 0) return `확인 필요: ${missingContext.join(", ")}`;
  if (taskType === "order_request" && inventory.status === "enough") return "정책 판단 후 주문 등록 및 출고 지시 후보 생성";
  if (taskType === "order_request" && inventory.status === "low_stock") return "안전재고 근접으로 승인 후 주문 처리";
  if (taskType === "quote_request") return "거래처/품목 매칭 완료. 단가 정책 확인 후 견적서 초안 생성";
  if (taskType === "delivery_inquiry") return "배송 상태 조회 후 답장 초안 생성";
  if (taskType === "payment_report") return "입금 내역 조회 매칭 후 관리자 확인 요청";
  return "사람이 검토";
}

function inventoryReason(status: InventoryStatus, shortageQuantity: number) {
  return {
    enough: "요청 수량을 안전재고 이상으로 처리 가능",
    low_stock: "처리는 가능하지만 안전재고에 근접",
    shortage: `${shortageQuantity}개 부족`,
    unknown: "요청 수량 또는 재고 정보가 부족",
    not_applicable: "재고 판단 대상 아님",
  }[status];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
