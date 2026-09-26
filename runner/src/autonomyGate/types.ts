// types.ts
// Autonomy Gate — 정규화 타입.
// 채팅(type+payload)과 Runner(approval_requests + studioCard) 두 세계를
// 하나의 GateInput으로 통일한다. (현재 비통일 상태를 해소하는 지점)

export type RiskLevel = "low" | "medium" | "high";
export type ApprovalPolicy = "owner_only" | "approval_required";

/** 게이트 운영 모드. 권장 전개 순서: SHADOW → ASSIST → AUTO */
export type GateMode = "SHADOW" | "ASSIST" | "AUTO";

/** 게이트가 내릴 수 있는 판단 */
export type GateOutcome = "AUTO_SEND" | "HUMAN_REVIEW";

/**
 * 정규화 입력. 채팅 카드/Runner 승인요청/studioCard 어느 쪽이든
 * adapters.ts가 이 형태로 바꿔서 게이트에 넘긴다.
 */
export interface GateInput {
  /** 어느 세계에서 왔는지 (감사·디버깅용) */
  source: "runner_approval" | "studio_card" | "chat_card";
  /** 원본 식별자 (approvalId, criterionId 등) */
  refId: string;
  companyId: string;
  /** 원본 액션 문자열 (options.action / card action) */
  action: string;
  /** 정규화된 액션 유형 (예: "dunning_reminder", "delivery_alert") */
  actionType: string;
  riskLevel: RiskLevel;
  approvalPolicy: ApprovalPolicy;
  /** 수신자가 검증된 기존 거래처인가 (미검증이면 자동 전송 차단) */
  recipientKnown: boolean;
  /** 되돌릴 수 있는 행동인가 (비가역이면 자동 전송 차단) */
  reversible: boolean;
  /** 키워드 매칭 대상 텍스트 (resultContent + preview + sourceSummary 등) */
  text: string;
  reason: string;
  /** 0..1. 미상이면 0으로 보아 보수적으로 사람 검토로 보낸다 */
  confidence: number;
  /** 비율 제한·전송용 수신자 키 (있으면) */
  recipientKey?: string;
  /**
   * 상류 AI가 명시적으로 사람 검토를 요구한 경우 true.
   * (needsHumanReview / riskLevel "uncertain" / "requires_check" / approve_send 미포함)
   * 무엇과도 무관하게 자동 전송을 막는다.
   */
  forceReview?: boolean;
  metadata: Record<string, unknown>;
}

/** 게이트 판단 결과 (이벤트로 적재) */
export interface GateDecision {
  outcome: GateOutcome;
  /** 자동으로 보낼 수 없게 막혔다면 그 사유 */
  blockedBy?: string;
  matchedCriterionId?: string;
  matchedKeywords: string[];
  scores: { confidence: number; criteriaMatch: boolean };
  decidedAt: string;
}

/** runAutonomyGate가 호출부에 돌려주는 최종 지시 */
export interface GateResult {
  decision: GateDecision;
  /** 호출부가 실제로 해야 할 일. SHADOW/ASSIST에서는 항상 HUMAN_REVIEW */
  effectiveOutcome: GateOutcome;
  /** AUTO 전송이 큐에 들어갔다면 그 작업 id (회수용) */
  dispatchId?: string;
  /** SHADOW 모드로 기록만 되었는가 */
  shadowed: boolean;
  mode: GateMode;
}

export interface GateConfig {
  mode: GateMode;
  /** 이 값 미만이면 자동 전송 불가 (기본 0.85) */
  confidenceThreshold: number;
  /** 자동 전송 허용 위험 등급 (기본 ["low"]) */
  autoEligibleRisk: RiskLevel[];
  /** 어떤 일이 있어도 자동 금지인 액션 유형 (금전·법적 구속 등) */
  hardBlockActions: string[];
  /** 전송 전 회수 가능 창 (ms). 기본 120000(2분) */
  dispatchDelayMs: number;
  /** 수신자별 1일 자동 전송 한도 (폭주 방지) */
  perRecipientDailyLimit: number;
  /** 전역 정지 스위치 */
  killSwitch: boolean;
}

export const DEFAULT_CONFIG: GateConfig = {
  mode: "SHADOW",
  confidenceThreshold: 0.85,
  autoEligibleRisk: ["low"],
  hardBlockActions: [
    "quote_finalize", // 견적 확정
    "contract_sign", // 계약 체결
    "payment", // 결제·송금
    "price_change_commit", // 단가 확정 변경
    "account_create", // 계정 생성
  ],
  dispatchDelayMs: 120_000,
  perRecipientDailyLimit: 5,
  killSwitch: false,
};
