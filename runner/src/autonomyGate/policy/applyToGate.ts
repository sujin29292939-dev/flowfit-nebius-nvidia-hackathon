// policy/applyToGate.ts
// Guardrail 결과를 GateInput에 반영하는 다리.
// 핵심: 룰 위반이 있으면 forceReview를 켜서 게이트 자동 전송을 원천 차단하고,
// cap_risk가 걸리면 위험등급을 강등(상향)해 게이트 판단을 보수적으로 만든다.

import type { GateInput, RiskLevel } from "../types.js";
import type { GuardrailResult, DraftUnderProof } from "./types.js";

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high"];

/** drafter 출력에서 Guardrail 검사용 형태를 뽑는다 */
export function toProof(input: GateInput): DraftUnderProof {
  const md = input.metadata ?? {};
  const presentFields = Array.isArray(md.presentFields)
    ? (md.presentFields as string[])
    : typeof md.missingFields !== "undefined"
      ? [] // missingFields만 있는 경우는 보수적으로 빈 배열
      : [];
  return {
    actionType: input.actionType,
    riskLevel: input.riskLevel,
    text: input.text,
    presentFields,
    amount: typeof md.amount === "number" ? (md.amount as number) : undefined,
  };
}

/**
 * Guardrail 결과를 GateInput에 적용한다.
 * - blocked 또는 위반 → forceReview 강제 ON
 * - cap_risk → 더 높은(위험한) 등급으로 강등하여 게이트가 보수적으로 보게 함
 */
export function applyGuardrail(input: GateInput, result: GuardrailResult): GateInput {
  let riskLevel = input.riskLevel;
  if (result.cappedRiskLevel) {
    // cap이 actual보다 낮으면(=더 엄격하면) cap 쪽을 쓰지 않고,
    // 위반 시에는 actual을 유지하되 forceReview로 막는다.
    // cap이 actual보다 높게 잡혀야 할 이유는 없으므로 max(actual, cap)로 보수화.
    riskLevel =
      RISK_ORDER.indexOf(input.riskLevel) >= RISK_ORDER.indexOf(result.cappedRiskLevel)
        ? input.riskLevel
        : result.cappedRiskLevel;
  }
  return {
    ...input,
    riskLevel,
    forceReview: input.forceReview || result.forceReview || result.blocked,
    metadata: {
      ...input.metadata,
      guardrail: {
        passed: result.passed,
        violations: result.violations,
        blocked: result.blocked,
      },
    },
  };
}
