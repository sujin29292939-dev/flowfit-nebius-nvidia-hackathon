// connect/kakaowork/config.ts
// 카카오워크 봇 연동. 슬랙과 달리 사용자 OAuth 로그인이 없다.
// 운영자가 카카오워크 관리자에서 봇을 만들고 발급받은 App Key로 동작한다.
//
// ── 운영자가 카카오워크에서 한 번 해야 하는 등록 ──
//  1. 카카오워크 관리자 > 봇 만들기 (API형 봇)
//  2. 발급된 App Key 확보
//  3. 환경변수 KAKAOWORK_APP_KEY 로 설정 (코드에 박지 않음)
//
// 사용자는 로그인하지 않는다. 봇이 이미 워크스페이스에 있으면 바로 전송된다.
// (이 점이 슬랙 OAuth와 가장 다른 부분)

export const KAKAOWORK_BASE = "https://api.kakaowork.com/v1";
export const KW_MESSAGES_SEND = `${KAKAOWORK_BASE}/messages.send`;
export const KW_MESSAGES_SEND_BY_EMAIL = `${KAKAOWORK_BASE}/messages.send_by_email`;
export const KW_CONVERSATIONS_OPEN = `${KAKAOWORK_BASE}/conversations.open`;
export const KW_USERS_FIND_BY_EMAIL = `${KAKAOWORK_BASE}/users.find_by_email`;
// 검증용 가벼운 호출: 봇이 만든 채팅방 목록 조회
export const KW_CONVERSATIONS_LIST = `${KAKAOWORK_BASE}/conversations.list`;

export interface KakaoworkConfig {
  appKey: string;
}

export function loadKakaoworkConfig(env: Record<string, string | undefined> = process.env): KakaoworkConfig {
  const appKey = env.KAKAOWORK_APP_KEY;
  if (!appKey) {
    throw new Error(
      "카카오워크 설정 누락: KAKAOWORK_APP_KEY. " +
        "카카오워크 관리자에서 봇 생성 후 App Key를 환경변수로 설정하세요.",
    );
  }
  return { appKey };
}
