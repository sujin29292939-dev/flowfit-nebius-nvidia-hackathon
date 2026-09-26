// connect/webhook/builders.ts
// 채널별 Webhook payload 빌더 + 헤더.
// Webhook은 URL이 곧 비밀이고 단방향이다. 채널마다 본문 형식이 다르므로
// "메시지 텍스트 → 채널 고유 payload" 변환을 여기서 흡수한다.

export interface WebhookRequest {
  body: string; // JSON 문자열
  headers: Record<string, string>;
}

/** 표준 입력 — 어느 채널이든 이 입력을 받아 채널 형식으로 변환 */
export interface WebhookMessage {
  text: string;
  /** 첨부 영역 색 (지원 채널만) */
  color?: string;
  /** 부가 정보 (title/description 쌍) */
  fields?: Array<{ title: string; description: string }>;
}

export type WebhookFlavor = "jandi" | "slack_incoming" | "discord" | "generic";

const JSON_HEADER = { "Content-Type": "application/json" };

/** 잔디 Team/Connect Incoming Webhook */
function jandi(msg: WebhookMessage): WebhookRequest {
  const payload: Record<string, unknown> = {
    body: msg.text,
    connectColor: msg.color ?? "#00C473",
  };
  if (msg.fields?.length) {
    payload.connectInfo = msg.fields.map((f) => ({ title: f.title, description: f.description }));
  }
  return {
    body: JSON.stringify(payload),
    headers: {
      Accept: "application/vnd.tosslab.jandi-v2+json", // 잔디 필수 Accept
      ...JSON_HEADER,
    },
  };
}

/** 슬랙 Incoming Webhook ({text}) — OAuth 대신 웹훅 쓸 때 */
function slackIncoming(msg: WebhookMessage): WebhookRequest {
  return { body: JSON.stringify({ text: msg.text }), headers: { ...JSON_HEADER } };
}

/** 디스코드 ({content}) */
function discord(msg: WebhookMessage): WebhookRequest {
  return { body: JSON.stringify({ content: msg.text }), headers: { ...JSON_HEADER } };
}

/** 일반 ({text}) — 형식 미상 채널 기본값 */
function generic(msg: WebhookMessage): WebhookRequest {
  return { body: JSON.stringify({ text: msg.text }), headers: { ...JSON_HEADER } };
}

const BUILDERS: Record<WebhookFlavor, (m: WebhookMessage) => WebhookRequest> = {
  jandi,
  slack_incoming: slackIncoming,
  discord,
  generic,
};

export function buildWebhookRequest(flavor: WebhookFlavor, msg: WebhookMessage): WebhookRequest {
  return (BUILDERS[flavor] ?? generic)(msg);
}
