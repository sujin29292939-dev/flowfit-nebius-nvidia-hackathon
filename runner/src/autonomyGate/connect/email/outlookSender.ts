// connect/email/outlookSender.ts
// Outlook 이메일 전송. 팀즈와 동일한 Graph 토큰(refresh 포함)을 재사용한다.
// Graph sendMail은 JSON이라 MIME 빌드가 필요 없다 — subject/body/toRecipients만.
//
// 토큰 공급은 함수로 주입받는다(팀즈 TeamsOAuthBroker.validAccessToken을 그대로 연결).

import { GRAPH_BASE } from "../teams/config.js";
import type { EmailMessage, EmailSendResult, EmailAddress, AccessTokenProvider } from "./mime.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const GRAPH_SENDMAIL_URL = `${GRAPH_BASE}/me/sendMail`;

function toRecipients(addrs: EmailAddress[]) {
  return addrs.map((a) => ({ emailAddress: { address: a.email, name: a.name } }));
}

interface GraphError {
  error?: { code?: string; message?: string };
}

export class OutlookSender {
  constructor(
    private getToken: AccessTokenProvider,
    private fetchFn: FetchFn = fetch,
  ) {}

  async send(msg: EmailMessage, now: number = Date.now()): Promise<EmailSendResult> {
    const token = await this.getToken(now);
    if (!token) return { ok: false, error: "no_valid_token" };

    const payload = {
      message: {
        subject: msg.subject,
        body: { contentType: msg.isHtml ? "HTML" : "Text", content: msg.body },
        toRecipients: toRecipients(msg.to),
        ...(msg.cc?.length ? { ccRecipients: toRecipients(msg.cc) } : {}),
      },
      saveToSentItems: true,
    };

    try {
      const res = await this.fetchFn(GRAPH_SENDMAIL_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // sendMail 성공은 202 Accepted, 본문 없음
      if (res.status === 202) return { ok: true };
      const data = (await res.json().catch(() => ({}))) as GraphError;
      return { ok: false, error: data.error?.code ?? `http_${res.status}` };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}
