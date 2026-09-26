// connect/kakaowork/kakaoworkClient.ts
// 카카오워크 봇 토큰 기반 검증 + 전송.
// App Key는 CredentialVault에서 참조로만 꺼낸다 (패키지 로직이 키를 들고 다니지 않음).
//
// 슬랙 SlackVerifier/SlackSender와 같은 포트(ConnectionVerifier 등)를 구현하므로
// 마법사·notify 경로에 동일하게 꽂힌다.

import type { ConnectionVerifier } from "../types.js";
import type { TokenResolver } from "../slack/slackVerifier.js";
import {
  KW_MESSAGES_SEND,
  KW_MESSAGES_SEND_BY_EMAIL,
  KW_CONVERSATIONS_OPEN,
  KW_CONVERSATIONS_LIST,
} from "./config.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** 카카오워크 공통 응답 구조: { success, error?, ... } */
interface KwBaseResponse {
  success: boolean;
  error?: { code?: string; message?: string };
}
interface KwConversationsOpenResponse extends KwBaseResponse {
  conversation?: { id: string | number };
}
interface KwMessagesSendResponse extends KwBaseResponse {
  message?: { id: string | number; conversation_id: string | number };
}

function authHeaders(appKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${appKey}`,
    "Content-Type": "application/json",
  };
}

/** 검증: conversations.list 를 가볍게 호출해 App Key 유효성 확인 */
export class KakaoworkVerifier implements ConnectionVerifier {
  constructor(
    private keys: TokenResolver,
    private fetchFn: FetchFn = fetch,
  ) {}

  async verify(_channelId: string, credentialRef: string): Promise<boolean> {
    const appKey = await this.keys.resolve(credentialRef);
    if (!appKey) return false;
    try {
      const res = await this.fetchFn(KW_CONVERSATIONS_LIST, {
        method: "GET",
        headers: authHeaders(appKey),
      });
      const data = (await res.json()) as KwBaseResponse;
      return data.success === true;
    } catch {
      return false;
    }
  }
}

export interface KwSendResult {
  ok: boolean;
  error?: string;
  messageId?: string;
  conversationId?: string;
}

export class KakaoworkSender {
  constructor(
    private keys: TokenResolver,
    private fetchFn: FetchFn = fetch,
  ) {}

  /** 채팅방 ID로 바로 전송 */
  async sendToConversation(
    credentialRef: string,
    conversationId: string,
    text: string,
  ): Promise<KwSendResult> {
    const appKey = await this.keys.resolve(credentialRef);
    if (!appKey) return { ok: false, error: "appkey_not_found" };
    try {
      const res = await this.fetchFn(KW_MESSAGES_SEND, {
        method: "POST",
        headers: authHeaders(appKey),
        body: JSON.stringify({ conversation_id: conversationId, text }),
      });
      const data = (await res.json()) as KwMessagesSendResponse;
      if (!data.success) return { ok: false, error: data.error?.code ?? "send_failed" };
      return {
        ok: true,
        messageId: data.message ? String(data.message.id) : undefined,
        conversationId: String(conversationId),
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /**
   * user_id만 알 때: 먼저 conversations.open으로 1:1 방을 열고 그 방에 전송.
   * (카카오워크는 user_id → conversation_id 변환이 필요)
   */
  async sendToUser(credentialRef: string, userId: string, text: string): Promise<KwSendResult> {
    const appKey = await this.keys.resolve(credentialRef);
    if (!appKey) return { ok: false, error: "appkey_not_found" };
    try {
      const openRes = await this.fetchFn(KW_CONVERSATIONS_OPEN, {
        method: "POST",
        headers: authHeaders(appKey),
        body: JSON.stringify({ user_id: userId }),
      });
      const open = (await openRes.json()) as KwConversationsOpenResponse;
      if (!open.success || !open.conversation) {
        return { ok: false, error: open.error?.code ?? "open_failed" };
      }
      return this.sendToConversation(credentialRef, String(open.conversation.id), text);
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** 이메일로 바로 전송 (방 생성 불필요) */
  async sendByEmail(credentialRef: string, email: string, text: string): Promise<KwSendResult> {
    const appKey = await this.keys.resolve(credentialRef);
    if (!appKey) return { ok: false, error: "appkey_not_found" };
    try {
      const res = await this.fetchFn(KW_MESSAGES_SEND_BY_EMAIL, {
        method: "POST",
        headers: authHeaders(appKey),
        body: JSON.stringify({ email, text }),
      });
      const data = (await res.json()) as KwMessagesSendResponse;
      if (!data.success) return { ok: false, error: data.error?.code ?? "send_failed" };
      return { ok: true, messageId: data.message ? String(data.message.id) : undefined };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}
