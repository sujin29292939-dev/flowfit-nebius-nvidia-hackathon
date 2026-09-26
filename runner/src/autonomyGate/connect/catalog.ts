// connect/catalog.ts
// 채널 카탈로그. 각 채널이 "어떻게 연결되는지"를 한곳에 정의한다.
// 마법사는 이 카탈로그만 보고 사용자에게 보여줄 단계를 결정한다.

/**
 * 연결 방식 3종.
 * - oauth: 사용자가 해당 서비스 화면에서 로그인+허용 클릭 (비밀번호는 우리 패키지를 거치지 않음). 가장 안전.
 * - api_key: 사용자가 서비스 설정에서 키를 발급해 붙여넣음 (OAuth 미지원 채널).
 * - webhook: 사용자가 서비스에서 Webhook URL을 만들어 붙여넣음 (단방향 전송).
 * - internal: 우리 제품 내부 채널 — 연결 불필요(API 직결).
 */
export type ConnectMethod = "oauth" | "api_key" | "webhook" | "internal";

export interface ChannelDef {
  id: string;
  label: string;
  method: ConnectMethod;
  /** 마법사가 "여기 누르세요"로 데려갈 시작 URL (oauth 시작점 / 키 발급 안내 페이지) */
  startUrl?: string;
  /** 사용자가 직접 해야 하는 단 한 가지 행동 설명 (무지식 사용자용 한 줄) */
  userAction: string;
  /** 전송 시 사용할 transport 키 (notifyTransport와 연결) */
  transport: "oauth_api" | "key_api" | "webhook" | "internal";
}

/**
 * 사용자가 적은 채널들을 연결 방식별로 분류.
 * (실제 키/URL 시그니처는 채널별 어댑터에서 채움 — 여기선 "어떻게 연결되는지"만)
 */
export const CHANNEL_CATALOG: Record<string, ChannelDef> = {
  // ── OAuth (한 번 클릭, 비밀번호 안 거침) ──
  slack: { id: "slack", label: "슬랙", method: "oauth", startUrl: "https://slack.com/oauth/v2/authorize", userAction: "슬랙 로그인 후 '허용' 한 번 클릭", transport: "oauth_api" },
  teams: { id: "teams", label: "MS 팀즈", method: "oauth", startUrl: "https://login.microsoftonline.com", userAction: "회사 계정 로그인 후 '허용' 클릭", transport: "oauth_api" },
  kakaowork: { id: "kakaowork", label: "카카오워크", method: "api_key", userAction: "카카오워크 봇 App Key 붙여넣기", transport: "key_api" },
  naverworks: { id: "naverworks", label: "네이버웍스", method: "oauth", userAction: "네이버웍스 로그인 후 '허용' 클릭", transport: "oauth_api" },
  dooray: { id: "dooray", label: "두레이", method: "oauth", userAction: "두레이 로그인 후 '허용' 클릭", transport: "oauth_api" },
  jira: { id: "jira", label: "지라", method: "oauth", userAction: "지라 로그인 후 '허용' 클릭", transport: "oauth_api" },
  notion: { id: "notion", label: "노션", method: "oauth", userAction: "노션 로그인 후 워크스페이스 '허용' 클릭", transport: "oauth_api" },
  google: { id: "google", label: "구글(폼/메일)", method: "oauth", userAction: "구글 로그인 후 '허용' 클릭", transport: "oauth_api" },

  // ── API 키 (OAuth 미지원 — 키 붙여넣기) ──
  kakaobiz: { id: "kakaobiz", label: "카카오 알림톡/비즈", method: "api_key", userAction: "카카오 비즈 콘솔에서 발급키 복사·붙여넣기", transport: "key_api" },
  channeltalk: { id: "channeltalk", label: "채널톡", method: "api_key", userAction: "채널톡 설정에서 API 키 복사·붙여넣기", transport: "key_api" },
  happytalk: { id: "happytalk", label: "해피톡", method: "api_key", userAction: "해피톡 관리자에서 키 복사·붙여넣기", transport: "key_api" },
  navertalk: { id: "navertalk", label: "네이버 톡톡", method: "api_key", userAction: "네이버 톡톡 파트너센터에서 키 복사·붙여넣기", transport: "key_api" },
  whatsapp: { id: "whatsapp", label: "왓츠앱 비즈니스", method: "api_key", userAction: "왓츠앱 비즈 API 토큰 붙여넣기", transport: "key_api" },
  jandi: { id: "jandi", label: "잔디", method: "webhook", userAction: "잔디 토픽에서 Webhook 주소 복사·붙여넣기", transport: "webhook" },
  flow: { id: "flow", label: "플로우", method: "api_key", userAction: "플로우 설정에서 키 복사·붙여넣기", transport: "key_api" },
  smartstore: { id: "smartstore", label: "스마트스토어", method: "api_key", userAction: "커머스API 키 붙여넣기", transport: "key_api" },
  coupang: { id: "coupang", label: "쿠팡", method: "api_key", userAction: "쿠팡 윙 API 키 붙여넣기", transport: "key_api" },

  // ── 이메일 ──
  email: { id: "email", label: "이메일", method: "oauth", userAction: "메일 계정 로그인 후 '허용' 클릭", transport: "oauth_api" },

  // ── 우리 제품 내부 (연결 불필요) ──
  order_system: { id: "order_system", label: "통합 주문 관리", method: "internal", userAction: "연결 불필요 (제품 내부)", transport: "internal" },
  selfmall: { id: "selfmall", label: "자사몰", method: "internal", userAction: "연결 불필요 (제품 내부)", transport: "internal" },
  web_po: { id: "web_po", label: "웹 발주 시스템", method: "internal", userAction: "연결 불필요 (제품 내부)", transport: "internal" },
};

export function getChannel(id: string): ChannelDef | undefined {
  return CHANNEL_CATALOG[id];
}

export function channelsByMethod(method: ConnectMethod): ChannelDef[] {
  return Object.values(CHANNEL_CATALOG).filter((c) => c.method === method);
}
