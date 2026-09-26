// policy/types.ts
// Policy Compiler 타입.
// 룰 메모리 + 모듈 설정을 읽어 (1) AI 주입 컨텍스트로 컴파일하고
// (2) AI 출력을 같은 룰로 검증(Guardrail)한다.

import type { RiskLevel } from "../types.js";

// ── 룰 메모리 ────────────────────────────────────────────────────────────────

/** 룰이 적용되는 액션 유형 범위. "*"는 전체 */
export type RuleScope = string; // 예: "dunning_reminder" | "*"

export type RuleEffect =
  | { kind: "force_review"; reason: string } // 무조건 사람 검토로
  | { kind: "block"; reason: string } // 아예 처리 금지
  | { kind: "cap_risk"; max: RiskLevel } // 위험등급 상한 강제
  | { kind: "require_field"; field: string } // 이 필드 없으면 검토
  | { kind: "forbid_phrase"; phrase: string } // 이 문구 포함 시 위반
  | { kind: "max_amount"; amount: number }; // 금액 상한 초과 시 위반

/**
 * 단일 룰. Admin만 수정/승격(권한 매트릭스).
 * priority 높을수록 먼저 적용. status로 활성 제어.
 */
export interface Rule {
  id: string;
  title: string;
  scope: RuleScope;
  effect: RuleEffect;
  priority: number;
  status: "active" | "candidate" | "disabled";
  /** 컨텍스트 프롬프트에 노출할 한 줄 (사람이 읽는 정책 문장) */
  statement: string;
  updatedBy: string;
  updatedAt: string;
}

// ── 모듈 설정 ────────────────────────────────────────────────────────────────

/** 모듈별 운영 설정. 값이 곧 룰의 파라미터가 된다(설정=룰 일원화). */
export interface ModuleSetting {
  module: string; // 예: "receivables" | "delivery" | "pricing"
  title: string;
  values: Record<string, number | string | boolean>;
  updatedBy: string;
  updatedAt: string;
}

// ── 컴파일 결과 ──────────────────────────────────────────────────────────────

/** AI 호출 앞단에 강제 주입되는 컨텍스트 */
export interface CompiledContext {
  /** 시스템 프롬프트에 덧붙일 정책 조각 (사람이 읽는 형태) */
  systemPromptFragment: string;
  /** AI 출력 제약 (구조화). drafter가 이 범위를 지켜야 함 */
  constraints: {
    forbiddenPhrases: string[];
    requiredFields: string[];
    maxRiskLevel: RiskLevel | null;
    maxAmount: number | null;
    forceReviewActions: string[];
    blockedActions: string[];
  };
  /** 이 컨텍스트가 어떤 룰/설정에서 나왔는지 (감사용 해시·목록) */
  provenance: {
    ruleIds: string[];
    settingModules: string[];
    compiledAt: string;
    hash: string;
  };
}

// ── Guardrail 결과 ───────────────────────────────────────────────────────────

export interface GuardrailViolation {
  ruleId: string;
  kind: RuleEffect["kind"];
  message: string;
}

export interface GuardrailResult {
  /** 룰 위반이 하나도 없으면 true */
  passed: boolean;
  violations: GuardrailViolation[];
  /** 위반으로 인해 강제 검토를 켜야 하는가 (게이트로 넘길 신호) */
  forceReview: boolean;
  /** 위반으로 인해 아예 처리 금지인가 */
  blocked: boolean;
  /** 룰에 의해 강등된 위험등급 (cap_risk 적용 결과) */
  cappedRiskLevel?: RiskLevel;
}

/** Guardrail이 검사하는 대상 (drafter 출력에서 추출한 정규화 형태) */
export interface DraftUnderProof {
  actionType: string;
  riskLevel: RiskLevel;
  text: string;
  presentFields: string[];
  amount?: number;
}
