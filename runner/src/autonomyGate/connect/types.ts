// connect/types.ts
// 연결 마법사 상태기계 타입.
// 핵심 안전 규칙: 비밀번호는 이 패키지를 절대 거치지 않는다.
//  - oauth: 사용자가 외부 서비스 화면에서 로그인 → 우리는 "연결됨 토큰"만 받음
//  - api_key/webhook: 사용자가 발급한 키/URL만 받음 (비밀번호 아님)

export type ConnectionStatus =
  | "not_started"
  | "awaiting_user_action" // 사용자가 외부 화면에서 로그인/허용/키복사 해야 함
  | "verifying" // 받은 토큰/키 유효성 확인 중
  | "connected"
  | "failed";

/** 한 채널의 연결 상태 (저장 대상) */
export interface ConnectionState {
  channelId: string;
  status: ConnectionStatus;
  /** 연결 증표 보관 참조 (실제 토큰은 보안 저장소 키만, 값은 여기 두지 않음) */
  credentialRef?: string;
  /** 토큰 만료 시각 (자동 갱신 판단용) */
  expiresAt?: string;
  lastError?: string;
  updatedAt: string;
}

/** 마법사가 UI에 내보내는 한 단계 지시 */
export interface WizardStep {
  channelId: string;
  label: string;
  status: ConnectionStatus;
  /** 사용자에게 보여줄 한 줄 안내 (무지식 기준) */
  instruction: string;
  /** 사용자가 눌러야 할 버튼/링크 (있으면) */
  actionUrl?: string;
  /** 사용자 입력이 필요한가 (api_key/webhook일 때 true), oauth는 false */
  needsUserInput: boolean;
  /** 입력이 필요하면 입력 라벨 (예: "API 키", "Webhook 주소") */
  inputLabel?: string;
}

/** 보안 저장소 포트 — 토큰/키는 여기에만, 값은 패키지 로직이 보지 않음 */
export interface CredentialVault {
  /** 토큰/키 저장 → 참조 키 반환 (값은 외부 보안 저장소에) */
  store(channelId: string, secret: string, expiresAt?: string): Promise<string> | string;
  /** 참조로 존재 확인 (값 반환 아님) */
  has(ref: string): Promise<boolean> | boolean;
  /** 참조 폐기 */
  revoke(ref: string): Promise<void> | void;
}

/** OAuth 시작/콜백 처리 포트 — 실제 OAuth는 서버가, 비밀번호는 외부 서비스가 처리 */
export interface OAuthBroker {
  /** 채널의 OAuth 동의 화면 URL 생성 (state 포함) */
  buildAuthUrl(channelId: string, redirectState: string): Promise<string> | string;
  /** 콜백의 인가코드를 토큰으로 교환 → {secret, expiresAt} */
  exchangeCode(
    channelId: string,
    code: string,
  ): Promise<{ secret: string; expiresAt?: string }> | { secret: string; expiresAt?: string };
}

/** 키/웹훅 유효성 검증 포트 — 실제 핑 테스트 */
export interface ConnectionVerifier {
  /** 저장된 자격증명으로 가벼운 호출을 보내 연결 확인 */
  verify(channelId: string, credentialRef: string): Promise<boolean> | boolean;
}

export interface WizardEventSink {
  emit(type: string, payload: Record<string, unknown>): void;
}
