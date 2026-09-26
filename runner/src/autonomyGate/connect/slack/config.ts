// connect/slack/config.ts
// 슬랙 OAuth 설정. 운영자(제품 제작자)가 슬랙에서 발급받아 환경변수로 주입한다.
//
// ── 운영자가 슬랙에서 한 번 해야 하는 등록 (사용자 아님) ──
//  1. https://api.slack.com/apps 에서 "Create New App"
//  2. OAuth & Permissions → Redirect URLs 에 우리 콜백 URL 등록
//     (예: https://app.flowfit.example/oauth/slack/callback)
//  3. Scopes(권한) 추가: 메시지 전송용 chat:write, 채널 조회용 channels:read 등
//  4. 발급되는 Client ID / Client Secret 을 환경변수로 설정
//     - SLACK_CLIENT_ID
//     - SLACK_CLIENT_SECRET   (절대 코드에 박지 않음)
//     - SLACK_REDIRECT_URI    (위 2번과 동일해야 함)
//
// 비밀번호는 등장하지 않는다. 사용자는 슬랙 화면에서 직접 로그인하고 "허용"만 누른다.

export interface SlackOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** 요청할 봇 권한 범위 */
  scopes: string[];
}

/** 환경변수에서 설정을 읽는다. 빠진 값이 있으면 명시적으로 알려준다. */
export function loadSlackConfig(env: Record<string, string | undefined> = process.env): SlackOAuthConfig {
  const clientId = env.SLACK_CLIENT_ID;
  const clientSecret = env.SLACK_CLIENT_SECRET;
  const redirectUri = env.SLACK_REDIRECT_URI;

  const missing: string[] = [];
  if (!clientId) missing.push("SLACK_CLIENT_ID");
  if (!clientSecret) missing.push("SLACK_CLIENT_SECRET");
  if (!redirectUri) missing.push("SLACK_REDIRECT_URI");
  if (missing.length > 0) {
    throw new Error(
      `슬랙 OAuth 설정 누락: ${missing.join(", ")}. ` +
        `슬랙 앱(api.slack.com/apps)에서 발급 후 환경변수로 설정하세요.`,
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: redirectUri!,
    scopes: (env.SLACK_SCOPES ?? "chat:write,channels:read").split(",").map((s) => s.trim()),
  };
}

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_ACCESS_URL = "https://slack.com/api/oauth.v2.access";
export const SLACK_AUTH_TEST_URL = "https://slack.com/api/auth.test";
export const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
