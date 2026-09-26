// policy/guardrail.ts
// AI 출력 검증기. 컴파일에 쓴 것과 "같은 룰"로 초안을 다시 본다.
// 위반이 있으면 forceReview를 켜거나(게이트 자동 전송 차단) 처리 자체를 막는다.

import type { RiskLevel } from "../types.js";
import type {
  Rule,
  GuardrailResult,
  GuardrailViolation,
  DraftUnderProof,
} from "./types.js";
import type { RuleStore } from "./stores.js";

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high"];

function exceedsRisk(actual: RiskLevel, max: RiskLevel): boolean {
  return RISK_ORDER.indexOf(actual) > RISK_ORDER.indexOf(max);
}

export class Guardrail {
  constructor(private rules: RuleStore) {}

  /** drafter 출력(정규화) ↔ active 룰 대조 */
  check(draft: DraftUnderProof): GuardrailResult {
    const applicable: Rule[] = this.rules.activeFor(draft.actionType);
    const violations: GuardrailViolation[] = [];
    let forceReview = false;
    let blocked = false;
    let cappedRiskLevel: RiskLevel | undefined;

    const haystack = draft.text.toLowerCase();

    for (const r of applicable) {
      const e = r.effect;
      switch (e.kind) {
        case "block":
          blocked = true;
          violations.push({ ruleId: r.id, kind: e.kind, message: `처리 금지: ${e.reason}` });
          break;

        case "force_review":
          forceReview = true;
          violations.push({ ruleId: r.id, kind: e.kind, message: `강제 검토: ${e.reason}` });
          break;

        case "forbid_phrase":
          if (haystack.includes(e.phrase.toLowerCase())) {
            forceReview = true;
            violations.push({
              ruleId: r.id,
              kind: e.kind,
              message: `금지 문구 포함: "${e.phrase}"`,
            });
          }
          break;

        case "require_field":
          if (!draft.presentFields.includes(e.field)) {
            forceReview = true;
            violations.push({
              ruleId: r.id,
              kind: e.kind,
              message: `필수 필드 누락: ${e.field}`,
            });
          }
          break;

        case "cap_risk":
          // 상한보다 위험하면 강제 검토 + 위험등급 상한으로 강등
          cappedRiskLevel = cappedRiskLevel
            ? (RISK_ORDER.indexOf(cappedRiskLevel) <= RISK_ORDER.indexOf(e.max)
                ? cappedRiskLevel
                : e.max)
            : e.max;
          if (exceedsRisk(draft.riskLevel, e.max)) {
            forceReview = true;
            violations.push({
              ruleId: r.id,
              kind: e.kind,
              message: `위험등급 상한 초과: ${draft.riskLevel} > ${e.max}`,
            });
          }
          break;

        case "max_amount":
          if (draft.amount !== undefined && draft.amount > e.amount) {
            forceReview = true;
            violations.push({
              ruleId: r.id,
              kind: e.kind,
              message: `금액 상한 초과: ${draft.amount} > ${e.amount}`,
            });
          }
          break;
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      forceReview,
      blocked,
      cappedRiskLevel,
    };
  }
}
