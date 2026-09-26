// connect/slack/slackVerifier.ts
// 슬랙 연결 검증 + 실제 전송.
//  - verify: 저장된 봇 토큰으로 auth.test 호출 → 유효하면 연결 성공
//  - send:   chat.postMessage 로 실제 메시지 전송
// 토큰 값은 CredentialVault에서 참조로만 꺼낸다 (패키지 로직이 토큰을 들고 다니지 않음).

import type { ConnectionVerifier } from "../types.js";
import { SLACK_AUTH_TEST_URL, SLACK_POST_MESSAGE_URL } from "./config.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** 참조(credentialRef) → 실제 토큰을 꺼내는 포트. 운영 보안 저장소가 구현 */
export interface TokenResolver {
  resolve(credentialRef: string): Promise<string | null> | string | null;
}

interface SlackAuthTestResponse {
  ok: boolean;
  error?: string;
  team?: string;
  user?: string;
  team_id?: string;
}

interface SlackPostResponse {
  ok: boolean;
  error?: string;
  ts?: string; // 메시지 타임스탬프 (성공 시)
  channel?: string;
}

export class SlackVerifier implements ConnectionVerifier {
  constructor(
    private tokens: TokenResolver,
    private fetchFn: FetchFn = fetch,
  ) {}

  /** auth.test 로 토큰 유효성 확인 */
  async verify(_channelId: string, credentialRef: string): Promise<boolean> {
    const token = await this.tokens.resolve(credentialRef);
    if (!token) return false;
    try {
      const res = await this.fetchFn(SLACK_AUTH_TEST_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as SlackAuthTestResponse;
      return data.ok === true;
    } catch {
      return false;
    }
  }
}

export interface SlackSendInput {
  credentialRef: string;
  channel: string; // 슬랙 채널 ID 또는 이름
  text: string;
}

export interface SlackSendResult {
  ok: boolean;
  error?: string;
  ts?: string;
}

/** 연결된 슬랙으로 실제 메시지 전송 (notify 경로의 staff_channel 구현체로 쓰임) */
export class SlackSender {
  constructor(
    private tokens: TokenResolver,
    private fetchFn: FetchFn = fetch,
  ) {}

  async send(input: SlackSendInput): Promise<SlackSendResult> {
    const token = await this.tokens.resolve(input.credentialRef);
    if (!token) return { ok: false, error: "token_not_found" };
    try {
      const res = await this.fetchFn(SLACK_POST_MESSAGE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: input.channel, text: input.text }),
      });
      const data = (await res.json()) as SlackPostResponse;
      return { ok: data.ok === true, error: data.error, ts: data.ts };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}
