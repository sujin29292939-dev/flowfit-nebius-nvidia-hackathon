// learning/index.ts
// 학습 레이어 공개 API + 물레방아 연결 헬퍼.

export * from "./types.js";
export * from "./ledger.js";
export * from "./ruleLearner.js";
export * from "./promotion.js";

import type { GateInput } from "../types.js";
import type { ApprovalEvent } from "./types.js";

/**
 * 게이트 입력 + 사람의 결정 → ApprovalEvent.
 * 승인 UI에서 approve/reject/revise가 확정될 때 호출해 학습기에 먹인다.
 * (물레방아 ④승인 → ⑤규칙학습 모서리)
 */
export function toApprovalEvent(
  input: GateInput,
  outcome: "approved" | "rejected" | "revised",
): ApprovalEvent {
  const md = input.metadata ?? {};
  const g = (md.guardrail as { violations?: unknown[] } | undefined);
  return {
    refId: input.refId,
    companyId: input.companyId,
    actionType: input.actionType,
    outcome,
    riskLevel: input.riskLevel,
    context: {
      recipientKnown: input.recipientKnown,
      matchedKeywords: Array.isArray(md.matchedKeywords)
        ? (md.matchedKeywords as string[])
        : undefined,
      fields: (md.presentFields ? { presentFields: md.presentFields } : undefined),
    },
    confidence: input.confidence,
    decidedAt: new Date().toISOString(),
  };
}
