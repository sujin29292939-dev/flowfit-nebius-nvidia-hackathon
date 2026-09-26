// recovery/recoveryPolicy.ts
// 실행 실패 후 복구 결정 정책 (단일 출처).
//
// 핵심 원칙(v1.3 §6): 실패 시 바로 재시도하지 않는다.
// 먼저 "무엇이 어디까지 반영되었는가"(mismatch 상태)를 확인한 뒤 결정한다.
// 이 결정은 AI 판단이 아니라 결정론적 룩업이다.
//
// 결정 4종:
//   AUTO_RECOVER   자동 복구 가능 — 비가역 반영이 없고 멱등 재시도가 안전
//   RECONCILE      대조 후 보정 — 로컬/ERP 상태가 엇갈려 원장 대조 후 보정
//   APPROVAL       승인 필요 — 사람 확인 후 진행
//   BLOCK          차단 후 사람 승인 — 위험. 자동 처리 절대 금지

export type RecoveryDecision = "AUTO_RECOVER" | "RECONCILE" | "APPROVAL" | "BLOCK";

export type FailureOrigin =
  | "runtime_crash" | "network_timeout" | "session_expired" | "ui_drift"
  | "validation_missing" | "duplicate_key" | "permission_denied"
  | "local_db_error" | "file_io_error" | "notification_error";

/** M01..M10 불일치 상태 코드 */
export type MismatchCode =
  | "M01" | "M02" | "M03" | "M04" | "M05" | "M06" | "M07" | "M08" | "M09" | "M10";

export type JobRisk = "low" | "medium" | "high" | "critical";

export interface RecoveryInput {
  mismatch: MismatchCode;
  failureOrigin: FailureOrigin;
  jobRisk: JobRisk;
  /** 실패가 발생한 단계 코드 S01..S20 (종단 단계는 자동 복구 금지) */
  stage?: string;
}

export interface RecoveryResult {
  decision: RecoveryDecision;
  requiresHumanApproval: boolean;
  reason: string;
}

/** 비가역 반영이 없어 멱등 재시도가 안전한 불일치 상태 */
const AUTO_RECOVERABLE_MISMATCHES = new Set<MismatchCode>(["M01", "M02", "M07", "M08", "M09"]);

/** 로컬/ERP가 엇갈려 원장 대조가 필요한 상태 */
const RECONCILE_MISMATCH: MismatchCode = "M03"; // 로컬 성공·ERP 없음

/** 항상 차단하는 위험 불일치 상태 */
const HARD_BLOCK_MISMATCHES = new Set<MismatchCode>([
  "M05", // 로컬 취소·ERP 확정건 있음 (취소했는데 ERP엔 확정 — 위험)
  "M06", // ERP 중복건 2개 이상 (이중 등록 — 위험)
]);

/** 자동 복구를 막는 실패 원인 (재시도 불가·확인 필요) */
const NON_RECOVERABLE_FAILURES = new Set<FailureOrigin>([
  "permission_denied", // 권한 문제는 재시도로 해결 안 됨
  "duplicate_key",     // 이미 존재 — 멱등 재시도 위험
]);

/** 종단 단계: 최종 저장/전송·외부 알림·동기화 이후는 자동 재시도 금지 */
const TERMINAL_STAGES = new Set<string>(["S16", "S17", "S18"]);

/** 아무것도 반영되지 않은 상태 (high 위험에서도 자동 복구 허용) */
const NOTHING_COMMITTED_MISMATCH: MismatchCode = "M01"; // 로컬 대기·ERP 없음

export function decideRecovery(input: RecoveryInput): RecoveryResult {
  const { mismatch, failureOrigin, jobRisk } = input;

  // 1) 권한 부족은 무엇과도 무관하게 차단
  if (failureOrigin === "permission_denied") {
    return block("권한 부족은 재시도로 해결되지 않아 사람 확인이 필요합니다.");
  }

  // 2) 위험 불일치 상태는 항상 차단 (이중 등록·취소 불일치)
  if (HARD_BLOCK_MISMATCHES.has(mismatch)) {
    return block(
      mismatch === "M06"
        ? "ERP 중복건 2개 이상 — 이중 등록 위험으로 자동 삭제·정정 금지, 사람 승인 필요."
        : "로컬 취소와 ERP 확정건 불일치 — 자동 처리 금지, 사람 승인 필요.",
    );
  }

  // 3) 중복키 충돌은 이미 결과가 존재할 수 있어 자동 재시도 금지 → 승인
  if (failureOrigin === "duplicate_key") {
    return approval("중복키 충돌 — 기존 결과 확인 후 진행해야 하므로 승인이 필요합니다.");
  }

  // 4) critical 업무는 반영 여부와 무관하게 승인 (자동/대조 금지)
  if (jobRisk === "critical") {
    return approval("critical 위험 업무는 자동 복구 대상이 아니며 사람 승인이 필요합니다.");
  }

  // 5) 로컬 성공·ERP 없음 → 대조 후 보정 (원장 대조로 강등/재작성)
  //    단, 종단 단계(최종 저장/전송·알림·동기화) 이후는 자동 보정 금지 → 승인
  if (mismatch === RECONCILE_MISMATCH) {
    if (input.stage && TERMINAL_STAGES.has(input.stage)) {
      return approval("로컬 성공·ERP 없음이지만 종단 단계 이후라 자동 보정 금지, 승인이 필요합니다.");
    }
    return {
      decision: "RECONCILE",
      requiresHumanApproval: false,
      reason: "로컬 성공·ERP 없음 — ERP를 원장으로 삼아 로컬 상태를 대조·보정합니다.",
    };
  }

  // 6) 자동 복구: 비가역 반영이 없는 상태 + 복구 가능한 실패 + 비종단 단계
  //    - low/medium 위험: 자동 복구 대상 mismatch 전부 허용
  //    - high 위험: 아무것도 반영되지 않은 M01만 허용(부분 반영 상태는 승인)
  if (
    AUTO_RECOVERABLE_MISMATCHES.has(mismatch) &&
    !NON_RECOVERABLE_FAILURES.has(failureOrigin) &&
    !(input.stage && TERMINAL_STAGES.has(input.stage))
  ) {
    const autoAllowed = jobRisk === "low" || jobRisk === "medium" || mismatch === NOTHING_COMMITTED_MISMATCH;
    if (autoAllowed) {
      return {
        decision: "AUTO_RECOVER",
        requiresHumanApproval: false,
        reason: "비가역 반영 없음·비종단 단계 — 상태 대조 후 멱등 재시도로 자동 복구합니다.",
      };
    }
  }

  // 7) 그 외(M04 로컬실패·ERP확정, M10 외부알림만 발송 등) → 승인
  return approval("로컬/ERP 반영이 엇갈려 보정 방향 결정에 사람 승인이 필요합니다.");
}

function block(reason: string): RecoveryResult {
  return { decision: "BLOCK", requiresHumanApproval: true, reason };
}

function approval(reason: string): RecoveryResult {
  return { decision: "APPROVAL", requiresHumanApproval: true, reason };
}

/** 데이터셋의 한국어 결정 라벨 ↔ 코드 매핑 (회귀 평가용) */
export const DECISION_LABEL_TO_CODE: Record<string, RecoveryDecision> = {
  "자동 복구 가능": "AUTO_RECOVER",
  "대조 후 보정": "RECONCILE",
  "승인 필요": "APPROVAL",
  "차단 후 사람 승인": "BLOCK",
};
