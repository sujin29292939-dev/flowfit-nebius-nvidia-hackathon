// connect/email/gmailSender.ts
// Gmail 이메일 전송. 구글 OAuth(만료 1시간, refresh 있음) 위에 얹힌다.
// Gmail은 MIME을 base64url로 인코딩해 raw 필드로 messages.send 호출.
//
// 구글 OAuth는 슬랙/팀즈와 토큰 응답 형식이 유사하므로 RefreshableTokens를 재사용한다.
//
// ── 운영자가 구글 클라우드 콘솔에서 한 번 해야 하는 등록 ──
//  1. console.cloud.google.com > OAuth 동의 화면 + 사용자 인증 정보(OAuth 클라이언트)
//  2. 승인된 리디렉션 URI 등록
//  3. Gmail API 사용 설정 + scope: https://www.googleapis.com/auth/gmail.send
//  4. 환경변수: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI

import type { EmailMessage, EmailSendResult, AccessTokenProvider } from "./mime.js";
import { buildMime, mimeToBase64Url } from "./mime.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export function loadGoogleConfig(env: Record<string, string | undefined> = process.env): GoogleOAuthConfig {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URI;
  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!redirectUri) missing.push("GOOGLE_REDIRECT_URI");
  if (missing.length > 0) {
    throw new Error(
      `구글 OAuth 설정 누락: ${missing.join(", ")}. ` +
        `구글 클라우드 콘솔에서 발급 후 환경변수로 설정하세요.`,
    );
  }
  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: redirectUri!,
    scopes: (env.GOOGLE_SCOPES ?? "https://www.googleapis.com/auth/gmail.send")
      .split(/[ ,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** 구글 동의 화면 URL. refresh_token 받으려면 access_type=offline + prompt=consent */
export function buildGoogleAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

interface GmailSendResponse {
  id?: string;
  threadId?: string;
  error?: { code?: number; message?: string };
}

export class GmailSender {
  constructor(
    private getToken: AccessTokenProvider,
    private fetchFn: FetchFn = fetch,
  ) {}

  async send(msg: EmailMessage, now: number = Date.now()): Promise<EmailSendResult> {
    const token = await this.getToken(now);
    if (!token) return { ok: false, error: "no_valid_token" };

    const raw = mimeToBase64Url(buildMime(msg));
    try {
      const res = await this.fetchFn(GMAIL_SEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      const data = (await res.json()) as GmailSendResponse;
      if (data.error) return { ok: false, error: data.error.message ?? "send_failed" };
      return { ok: true, messageId: data.id };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}
