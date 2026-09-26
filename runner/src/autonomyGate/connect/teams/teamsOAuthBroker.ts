// connect/teams/teamsOAuthBroker.ts
// 팀즈 OAuth 브로커 + refresh 갱신 + Graph 전송.
//  - buildAuthUrl: Azure 동의 화면 (offline_access 포함)
//  - exchangeCode: 인가코드 → access+refresh 토큰
//  - refresh:      refresh_token → 새 access 토큰 (RefreshableTokens가 호출)
//  - send:         Graph API로 채널 메시지 전송 (만료 시 자동 갱신 후 전송)

import type { OAuthBroker } from "../types.js";
import { MemoryStateStore, type StateStore } from "../slack/slackOAuthBroker.js";
import {
  RefreshableTokens,
  expiresInToIso,
  type TokenBundle,
  type RefreshFn,
} from "../refreshable.js";
import {
  type TeamsOAuthConfig,
  authorizeUrl,
  tokenUrl,
  channelMessageUrl,
} from "./config.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface MsTokenResponse {
  token_type?: string;
  scope?: string;
  expires_in?: number;
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

export class TeamsOAuthBroker implements OAuthBroker {
  constructor(
    private config: TeamsOAuthConfig,
    private tokens: RefreshableTokens,
    private states: StateStore = new MemoryStateStore(),
    private fetchFn: FetchFn = fetch,
  ) {}

  buildAuthUrl(channelId: string, _redirectState: string): string {
    const state = this.states.issue(channelId);
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: this.config.redirectUri,
      response_mode: "query",
      scope: this.config.scopes.join(" "),
      state,
    });
    return `${authorizeUrl(this.config.tenant)}?${params.toString()}`;
  }

  verifyState(state: string): boolean {
    return this.states.consume(state);
  }

  /** 인가코드 → 토큰. RefreshableTokens에 묶음 저장하고 access를 secret으로 반환 */
  async exchangeCode(channelId: string, code: string): Promise<{ secret: string; expiresAt?: string }> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(" "),
    });
    const data = await this.postToken(body);
    const bundle: TokenBundle = {
      accessToken: data.access_token!,
      refreshToken: data.refresh_token,
      expiresAt: expiresInToIso(data.expires_in ?? 3600),
      scope: data.scope,
    };
    await this.tokens.save(this.key(channelId), bundle);
    return { secret: bundle.accessToken, expiresAt: bundle.expiresAt };
  }

  /** RefreshableTokens가 만료 시 호출하는 갱신 함수 */
  refreshFn(): RefreshFn {
    return async (refreshToken: string): Promise<TokenBundle> => {
      const body = new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: this.config.scopes.join(" "),
      });
      const data = await this.postToken(body);
      return {
        accessToken: data.access_token!,
        refreshToken: data.refresh_token, // 회전되면 새 값, 아니면 undefined → 호출부가 기존 유지
        expiresAt: expiresInToIso(data.expires_in ?? 3600),
        scope: data.scope,
      };
    };
  }

  /** 유효한 access token 확보 (만료 시 자동 갱신) */
  async validAccessToken(channelId: string, now: number = Date.now()): Promise<string | null> {
    return this.tokens.getValidAccessToken(this.key(channelId), this.refreshFn(), now);
  }

  private key(channelId: string): string {
    return `teams:${channelId}`;
  }

  private async postToken(body: URLSearchParams): Promise<MsTokenResponse> {
    const res = await this.fetchFn(tokenUrl(this.config.tenant), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await res.json()) as MsTokenResponse;
    if (!data.access_token) {
      throw new Error(`팀즈 토큰 요청 실패: ${data.error ?? "unknown"} ${data.error_description ?? ""}`.trim());
    }
    return data;
  }
}

// ── Graph 전송 ────────────────────────────────────────────────────────────────

interface GraphMessageResponse {
  id?: string;
  error?: { code?: string; message?: string };
}

export interface TeamsSendResult {
  ok: boolean;
  error?: string;
  messageId?: string;
}

/** 팀즈 채널 메시지 전송. 토큰 만료 시 broker가 자동 갱신 */
export class TeamsSender {
  constructor(
    private broker: TeamsOAuthBroker,
    private fetchFn: FetchFn = fetch,
  ) {}

  async sendChannelMessage(
    channelKey: string,
    teamId: string,
    channelId: string,
    text: string,
    now: number = Date.now(),
  ): Promise<TeamsSendResult> {
    const token = await this.broker.validAccessToken(channelKey, now);
    if (!token) return { ok: false, error: "no_valid_token" };
    try {
      const res = await this.fetchFn(channelMessageUrl(teamId, channelId), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ body: { contentType: "html", content: text } }),
      });
      const data = (await res.json()) as GraphMessageResponse;
      if (data.error) return { ok: false, error: data.error.code ?? "send_failed" };
      return { ok: true, messageId: data.id };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}
