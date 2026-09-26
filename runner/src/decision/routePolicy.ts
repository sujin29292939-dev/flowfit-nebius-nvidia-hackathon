// decision/routePolicy.ts
// 이해 결과가 정확하다고 판단될 때 "다음에 무엇을 해야 하는가"를 정하는 단일 정책.
//
// 우선순위 (위에서부터 먼저 적용):
//   1) 정보가 부족하거나 불확실하면        → clarification_required (되묻기)
//   2) 비가역 쓰기·고위험·고액이면          → approval_required      (사람 승인 필수)
//   3) 외부로 나가는 초안성 작업이면        → draft_then_approve     (초안 생성 후 승인 대기)
//   4) 읽기 전용이고 확신도가 충분하면      → execute_low_risk       (저위험 자동 실행)
//   해당 없음                              → approval_required      (보수적 기본값)
//
// Autonomy Gate와 같은 원칙: 비가역이면 자동 금지, 불확실하면 사람에게.

import type { TaskUnderstandingResult, BusinessTaskType } from "../understanding/types.js";

export type WorkRoute =
  | "clarification_required"
  | "approval_required"
  | "draft_then_approve"
  | "execute_low_risk";

/** 되돌릴 수 없는 쓰기 작업 — 자동 실행 절대 금지, 항상 승인 */
const IRREVERSIBLE_WRITE: ReadonlySet<BusinessTaskType> = new Set([
  "order_request",
  "order_update",
  "return_exchange",
  "data_update",
]);

/** 외부 발신 초안 — 초안까지 만들고 전송 전 승인 */
const DRAFTABLE_OUTBOUND: ReadonlySet<BusinessTaskType> = new Set([
  "reply_draft",
  "quote_request",
  "complaint",
  "invoice_request",
]);

/** 읽기 전용 — 확신도만 충분하면 저위험 자동 실행 가능 */
const READ_ONLY: ReadonlySet<BusinessTaskType> = new Set([
  "inventory_inquiry",
  "delivery_inquiry",
  "report_request",
  "payment_report", // 입금 '대조'는 조회. 송금/환불은 아예 다루지 않음(Gate에서 차단)
]);

export interface RoutePolicyConfig {
  /** 이 미만이면 무조건 되묻기 */
  minConfidence: number;
  /** 읽기 전용 자동 실행에 필요한 확신도 */
  autoRunConfidence: number;
  /** 이 금액 이상이면 무조건 승인 (원) */
  approvalAmountThreshold: number;
}

export const DEFAULT_ROUTE_POLICY: RoutePolicyConfig = {
  minConfidence: 0.55,
  autoRunConfidence: 0.75,
  approvalAmountThreshold: 500_000,
};

export interface RouteDecision {
  route: WorkRoute;
  reason: string;
}

export function decideRoute(
  result: TaskUnderstandingResult,
  config: RoutePolicyConfig = DEFAULT_ROUTE_POLICY,
): RouteDecision {
  // 1) 되묻기
  if (result.taskType === "unknown" || result.taskType === "general_request") {
    return { route: "clarification_required", reason: "업무 유형을 특정할 수 없음" };
  }
  if (result.missingFields.length > 0) {
    return { route: "clarification_required", reason: `필수 정보 부족: ${result.missingFields.join(", ")}` };
  }
  if (result.needsHumanReview && result.riskLevel === "uncertain") {
    return { route: "clarification_required", reason: "이해 결과가 불확실함" };
  }
  if (result.confidence < config.minConfidence) {
    return { route: "clarification_required", reason: `확신도 부족 (${result.confidence})` };
  }

  // 2) 승인 필수
  if ((result.fields.amount ?? 0) >= config.approvalAmountThreshold) {
    return { route: "approval_required", reason: `고액 (${result.fields.amount}원)` };
  }
  if (result.riskLevel === "high") {
    return { route: "approval_required", reason: "고위험 업무" };
  }
  if (IRREVERSIBLE_WRITE.has(result.taskType)) {
    return { route: "approval_required", reason: "비가역 쓰기 작업" };
  }

  // 3) 초안 후 승인
  if (DRAFTABLE_OUTBOUND.has(result.taskType)) {
    return { route: "draft_then_approve", reason: "외부 발신 초안 작업" };
  }

  // 4) 저위험 자동 실행
  if (READ_ONLY.has(result.taskType) && result.confidence >= config.autoRunConfidence) {
    return { route: "execute_low_risk", reason: "읽기 전용 + 확신도 충분" };
  }
  if (READ_ONLY.has(result.taskType)) {
    return { route: "draft_then_approve", reason: "읽기 전용이지만 확신도가 자동 실행 기준 미달" };
  }

  // 기본값: 보수적으로 승인
  return { route: "approval_required", reason: "정책에 해당 없음 — 보수적 기본값" };
}
