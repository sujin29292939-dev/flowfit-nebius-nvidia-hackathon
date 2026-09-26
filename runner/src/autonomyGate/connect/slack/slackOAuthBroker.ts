// connect/slack/slackOAuthBroker.ts
// 실제 슬랙 OAuth 브로커. MockOAuthBroker 자리에 그대로 들어간다.
//  - buildAuthUrl: 슬랙 동의 화면 URL 생성 (CSRF 방지용 state 포함)
//  - exchangeCode: 인가코드 → 봇 토큰 교환 (슬랙 oauth.v2.access 호출)
// 클라이언트 시크릿은 환경변수에서만 읽고, 토큰 교환은 슬랙 서버와 직접 통신한다.

import type { OAuthBroker } from "../types.js";
import {
  type SlackOAuthConfig,
  SLACK_AUTHORIZE_URL,
  SLACK_ACCESS_URL,
} from "./config.js";

/** state 발급·검증 저장소 (CSRF 방지). 운영에서는 Redis 등으로 교체 */
export interface StateStore {
  issue(channelId: string): string; // 새 state 발급
  consume(state: string): boolean; // 1회용 검증 (성공 시 소비)
}

export class MemoryStateStore implements StateStore {
  private valid = new Set<string>();
  private seq = 0;
  issue(channelId: string): string {
    this.seq += 1;
    const s = `${channelId}.${Date.now()}.${this.seq}.${Math.random().toString(36).slice(2, 10)}`;
    this.valid.add(s);
    return s;
  }
  consume(state: string): boolean {
    if (!this.valid.has(state)) return false;
    this.valid.delete(state);
    return true;
  }
}

/** fetch 주입 가능 (테스트용). 기본은 전역 fetch */
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface SlackAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string; // 봇 토큰 (xoxb-...)
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  team?: { id: string; name: string };
  authed_user?: { id: string };
  expires_in?: number; // 토큰 회전 사용 시
}

export class SlackOAuthBroker implements OAuthBroker {
  constructor(
    private config: SlackOAuthConfig,
    private states: StateStore = new MemoryStateStore(),
    private fetchFn: FetchFn = fetch,
  ) {}

  /** 동의 화면 URL. 사용자는 이 링크를 눌러 슬랙에서 로그인+허용 */
  buildAuthUrl(channelId: string, _redirectState: string): string {
    const state = this.states.issue(channelId);
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      scope: this.config.scopes.join(","),
      redirect_uri: this.config.redirectUri,
      state,
    });
    return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
  }

  /** 콜백에서 받은 state를 검증 (라우트 핸들러가 호출) */
  verifyState(state: string): boolean {
    return this.states.consume(state);
  }

  /** 인가코드 → 봇 토큰. 슬랙 oauth.v2.access 직접 호출 */
  async exchangeCode(
    _channelId: string,
    code: string,
  ): Promise<{ secret: string; expiresAt?: string }> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri,
    });

    const res = await this.fetchFn(SLACK_ACCESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = (await res.json()) as SlackAccessResponse;
    if (!data.ok || !data.access_token) {
      throw new Error(`슬랙 토큰 교환 실패: ${data.error ?? "unknown"}`);
    }

    // 봇 토큰을 secret으로 반환. 토큰 회전을 쓰면 expires_in이 옴.
    const expiresAt =
      typeof data.expires_in === "number"
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : undefined;

    return { secret: data.access_token, expiresAt };
  }
}
