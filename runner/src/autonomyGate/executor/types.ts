// executor/types.ts
// 온디바이스 화면 자동화 실행기 타입.
// 게이트와 독립된 2차 방어선: 실제 화면 앞에서 단계별로 다시 검증하고,
// 어긋나면 부분 전송 없이 전체 중단한다.

/** stop_conditions — 하나라도 발생하면 즉시 중단 */
export type StopCondition =
  | "unexpected_app" // 기대한 앱이 아님
  | "no_recent_message_match" // 최근 메시지가 기대 발신자/내용과 불일치
  | "confidence_below_min" // 화면 검증 신뢰도가 임계 미만
  | "ambiguous_target" // 답장 대상이 모호 (대화방 다수 등)
  | "reply_field_not_found" // 입력 필드를 찾지 못함
  | "send_button_not_found" // 전송 버튼을 찾지 못함
  | "screen_changed_midway" // 실행 중 화면이 예기치 않게 바뀜
  | "timeout" // 단계 시간 초과
  | "driver_error"; // 드라이버 예외

/** 실행 단계 */
export type ExecStep =
  | "validate_app"
  | "match_recent_message"
  | "input_text"
  | "tap_send";

export type ExecOutcome = "succeeded" | "stopped" | "failed";

/** 단계 1건 결과 */
export interface StepResult {
  step: ExecStep;
  ok: boolean;
  stopCondition?: StopCondition;
  detail: string;
  /** 화면 검증 신뢰도 (0..1) */
  confidence?: number;
  at: string;
}

/** 실행 전체 결과 */
export interface ExecutionResult {
  outcome: ExecOutcome;
  steps: StepResult[];
  stoppedAt?: ExecStep;
  stopCondition?: StopCondition;
  /** 실제로 전송이 완료되었는가 (tap_send 성공 시에만 true) */
  delivered: boolean;
  startedAt: string;
  finishedAt: string;
}

/** 실행 명세 — NotifyCommand에서 추출한 안전 검증 정보 */
export interface ExecutionSpec {
  commandId: string;
  deviceId: string;
  packageName: string; // 기대 앱 (예: com.kakao.talk)
  expectedSenderHint: string | null; // 기대 발신자
  expectedBodyHint: string | null; // 최근 메시지 본문 힌트
  notificationKeyHash: string | null;
  replyText: string;
  /** 허용 액션 (이 목록 밖의 행동은 시도하지 않음) */
  allowedActions: string[];
  stopConditions: StopCondition[];
  safety: {
    requiresPreSendValidation: boolean;
    minConfidence: number;
    requireExpectedApp: boolean;
    requireRecentMessageMatch: boolean;
  };
}

// ── 화면 드라이버 포트 (실제 OpenClaw/접근성 드라이버를 끼움) ──────────────────

/** 현재 화면 관찰 결과 */
export interface ScreenObservation {
  foregroundPackage: string;
  /** 최근 메시지 발신자(보이는 경우) */
  visibleSender: string | null;
  /** 최근 메시지 본문(보이는 경우) */
  visibleRecentBody: string | null;
  hasReplyField: boolean;
  hasSendButton: boolean;
  /** 화면 인식 신뢰도 (0..1) */
  recognitionConfidence: number;
  /** 답장 대상 후보 개수 (1이어야 명확) */
  candidateTargets: number;
}

/** 추상 화면 드라이버. 부작용(입력·탭)은 여기서만 일어난다. */
export interface ScreenDriver {
  /** 현재 화면 관찰 */
  observe(): Promise<ScreenObservation> | ScreenObservation;
  /** 답장 입력 필드에 텍스트 입력 (부작용) */
  inputText(text: string): Promise<boolean> | boolean;
  /** 전송 버튼 탭 (부작용 — 실제 전송) */
  tapSend(): Promise<boolean> | boolean;
}

/** 감사 이벤트 싱크 (executor 전용 재선언, dispatchQueue와 호환) */
export interface ExecEventSink {
  emit(type: string, payload: Record<string, unknown>): void;
}
