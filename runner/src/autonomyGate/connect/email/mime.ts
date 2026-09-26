// connect/email/mime.ts
// 이메일 공통 부품: 발송 입력 + RFC 2822 MIME 빌더.
// Gmail은 이 MIME을 base64url로 인코딩해 raw로 보낸다.
// Outlook은 MIME이 필요 없지만(JSON), 같은 EmailMessage 입력을 공유한다.

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailMessage {
  to: EmailAddress[];
  cc?: EmailAddress[];
  subject: string;
  /** 본문 (기본 text/plain; html이면 isHtml=true) */
  body: string;
  isHtml?: boolean;
  from?: EmailAddress;
}

function formatAddr(a: EmailAddress): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

/** RFC 2822 MIME 문자열 생성 (Gmail용) */
export function buildMime(msg: EmailMessage): string {
  const lines: string[] = [];
  if (msg.from) lines.push(`From: ${formatAddr(msg.from)}`);
  lines.push(`To: ${msg.to.map(formatAddr).join(", ")}`);
  if (msg.cc?.length) lines.push(`Cc: ${msg.cc.map(formatAddr).join(", ")}`);
  // 제목은 비ASCII(한글) 대응 위해 RFC 2047 인코딩
  lines.push(`Subject: ${encodeHeader(msg.subject)}`);
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: ${msg.isHtml ? "text/html" : "text/plain"}; charset=UTF-8`);
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  // 본문도 base64로 (한글 안전)
  lines.push(base64(msg.body));
  return lines.join("\r\n");
}

/** RFC 2047 제목 인코딩 (한글 등 비ASCII) */
function encodeHeader(s: string): string {
  // ASCII만 있으면 그대로
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${base64(s)}?=`;
}

function base64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

/** base64url (Gmail raw용): +/= 를 -_ 로, 패딩 제거 */
export function toBase64Url(s: string): string {
  return Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 이미 만든 MIME 문자열을 base64url로 (Gmail raw 필드값) */
export function mimeToBase64Url(mime: string): string {
  return Buffer.from(mime, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface EmailSendResult {
  ok: boolean;
  error?: string;
  messageId?: string;
}

/** 유효한(만료 시 갱신된) access token을 돌려주는 공급자. Gmail/Outlook 공용 */
export type AccessTokenProvider = (now?: number) => Promise<string | null>;
