// connect/webhook/webhookSender.ts
// 공통 Webhook 전송기 + 검증기.
// URL은 CredentialVault에서 참조로만 꺼낸다(URL 자체가 비밀이라 로그 노출 금지).
// 전송 전 URL 안전성을 검사한다(https 강제 + 사설/내부 주소 차단 = SSRF 방어).

import type { ConnectionVerifier } from "../types.js";
import type { TokenResolver } from "../slack/slackVerifier.js";
import { buildWebhookRequest, type WebhookFlavor, type WebhookMessage } from "./builders.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface WebhookSendResult {
  ok: boolean;
  error?: string;
  status?: number;
}

/** URL 안전성 검사: https만 허용 + 내부/사설 호스트 차단 */
export function isSafeWebhookUrl(raw: string): { ok: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "https_required" };
  const host = u.hostname.toLowerCase();
  // 내부/사설 대역 차단 (SSRF 방어)
  const blocked =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || // 링크로컬/메타데이터
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) return { ok: false, reason: "blocked_host" };
  return { ok: true };
}

export class WebhookSender {
  constructor(
    private urls: TokenResolver, // credentialRef → 실제 URL
    private fetchFn: FetchFn = fetch,
  ) {}

  async send(
    credentialRef: string,
    flavor: WebhookFlavor,
    msg: WebhookMessage,
  ): Promise<WebhookSendResult> {
    const url = await this.urls.resolve(credentialRef);
    if (!url) return { ok: false, error: "url_not_found" };

    const safe = isSafeWebhookUrl(url);
    if (!safe.ok) return { ok: false, error: safe.reason };

    const req = buildWebhookRequest(flavor, msg);
    try {
      const res = await this.fetchFn(url, {
        method: "POST", // 잔디 등은 POST 필수
        headers: req.headers,
        body: req.body,
      });
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
      return { ok: false, error: `http_${res.status}`, status: res.status };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}

/**
 * Webhook 검증: 실제 전송 없이 URL 형식·안전성만 확인한다.
 * (테스트 메시지를 보내면 실제 채팅방에 노출되므로, 등록 시점엔 형식 검증만)
 */
export class WebhookVerifier implements ConnectionVerifier {
  constructor(private urls: TokenResolver) {}

  async verify(_channelId: string, credentialRef: string): Promise<boolean> {
    const url = await this.urls.resolve(credentialRef);
    if (!url) return false;
    return isSafeWebhookUrl(url).ok;
  }
}
