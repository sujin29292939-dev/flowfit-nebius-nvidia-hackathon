// learning/types.ts
// Rule Learner 타입. 승인 이벤트를 읽어 룰 후보를 제안하고,
// 액션 유형별 신뢰도를 누적해 AUTO 승격 후보를 만든다.
// 절대 원칙: 학습은 이벤트를 읽을 뿐 룰을 자동 활성화하지 않는다(Admin 승격 필요).

import type { RiskLevel } from "../types.js";
import type { RuleEffect } from "../policy/types.js";

/** 사람이 승인을 내릴 때 적재되는 이벤트 (event-first의 입력) */
export interface ApprovalEvent {
  refId: string;
  companyId: string;
  actionType: string;
  /** 사람의 최종 결정 */
  outcome: "approved" | "rejected" | "revised";
  riskLevel: RiskLevel;
  /** 매칭에 쓰인 맥락 (거래처 유형·키워드 등) — 일반화 근거 */
  context: {
    recipientKnown: boolean;
    matchedKeywords?: string[];
    fields?: Record<string, unknown>;
  };
  /** 승인 당시 초안 신뢰도 */
  confidence: number;
  decidedAt: string;
}

/** Rule Learner가 내놓는 룰 후보 (status는 항상 candidate) */
export interface RuleCandidate {
  id: string;
  actionType: string;
  /** 제안된 효과 (대부분 force_review 완화나 cap_risk 조정) */
  proposedEffect: RuleEffect;
  statement: string;
  /** 근거 통계 */
  evidence: {
    approvedCount: number;
    rejectedCount: number;
    revisedCount: number;
    total: number;
    approvalRate: number;
    sampleRefIds: string[];
  };
  createdAt: string;
}

/** 액션 유형별 신뢰도 원장 (누적). AUTO 승격 판단의 입력 */
export interface ConfidenceLedgerEntry {
  actionType: string;
  approvedCount: number;
  rejectedCount: number;
  revisedCount: number;
  total: number;
  /** 베이지안 평활 적용 신뢰도 (0..1) */
  smoothedConfidence: number;
  /** AUTO 승격 임계를 넘었는가 */
  promotable: boolean;
}

/** AUTO 승격 후보 (게이트 자동 전송 등급 승격 제안) */
export interface PromotionProposal {
  actionType: string;
  reason: string;
  ledger: ConfidenceLedgerEntry;
  /** 제안된 자동 전송 기준 (registry.upsertFromCard 입력 형태) */
  suggestedCriterion: {
    criterionId: string;
    criterionTitle: string;
    autoAllowed: boolean; // 항상 false로 제안 — Admin이 켜야 켜짐
    keywords: string[];
    actionType: string;
  };
  createdAt: string;
}

export interface LearnerConfig {
  /** 후보 제안 최소 표본 수 */
  minSamplesForCandidate: number;
  /** AUTO 승격 최소 표본 수 */
  minSamplesForPromotion: number;
  /** AUTO 승격 신뢰도 임계 */
  promotionConfidenceThreshold: number;
  /** 베이지안 평활 강도 (가짜 관측 수) */
  smoothingStrength: number;
  /** 반려가 이 비율 넘으면 후보/승격 제안 안 함 */
  maxRejectionRate: number;
}

export const DEFAULT_LEARNER_CONFIG: LearnerConfig = {
  minSamplesForCandidate: 5,
  minSamplesForPromotion: 20,
  promotionConfidenceThreshold: 0.9,
  smoothingStrength: 5,
  maxRejectionRate: 0.1,
};
