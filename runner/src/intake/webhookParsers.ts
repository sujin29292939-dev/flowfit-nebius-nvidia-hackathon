// intake/webhookParsers.ts
// 외부 웹훅 payload를 intakes 저장 입력으로 정규화한다.

import type { CreateIntakeInput } from "./types.js";
import { getDefaultCompanyId } from "./config.js";

export function parseSmsPayload(payload: Record<string, unknown>, provider = "generic"): CreateIntakeInput {
  const companyId = getString(payload.companyId) ?? getDefaultCompanyId();
  const from =
    getString(payload.from) ??
    getString(payload.sender) ??
    getString(payload.phone) ??
    getString(payload.senderNumber) ??
    getString(payload.fromNumber);
  const text =
    getString(payload.text) ??
    getString(payload.message) ??
    getString(payload.content) ??
    getString(payload.body) ??
    "";
  const externalId =
    getString(payload.messageId) ??
    getString(payload.id) ??
    getString(payload.msgId) ??
    getString(payload.requestId);

  return {
    companyId,
    sourceType: "sms",
    sourceName: getString(payload.sourceName) ?? provider,
    rawText: text,
    receivedAt: parseDate(payload.receivedAt ?? payload.date ?? payload.timestamp),
    metadata: {
      provider,
      externalId,
      from,
      to: getString(payload.to) ?? getString(payload.receiver),
      rawPayload: payload,
    },
  };
}

export function parseEmailPayload(payload: Record<string, unknown>): CreateIntakeInput {
  const companyId = getString(payload.companyId) ?? getDefaultCompanyId();
  const subject = getString(payload.subject) ?? "(no subject)";
  const from = getString(payload.from) ?? getString(payload.sender);
  const text =
    getString(payload.text) ??
    getString(payload.plain) ??
    getString(payload.body) ??
    stripHtml(getString(payload.html) ?? "");
  const externalId =
    getString(payload.messageId) ??
    getString(payload["message-id"]) ??
    getString(payload.id) ??
    getString(payload.emailId);

  return {
    companyId,
    sourceType: "email",
    sourceName: getString(payload.sourceName) ?? "email_webhook",
    rawText: [`제목: ${subject}`, from ? `보낸 사람: ${from}` : "", "", text].filter(Boolean).join("\n"),
    receivedAt: parseDate(payload.receivedAt ?? payload.date ?? payload.timestamp),
    attachmentRefs: normalizeAttachmentRefs(payload.attachments),
    metadata: {
      externalId,
      subject,
      from,
      to: getString(payload.to),
      cc: getString(payload.cc),
      rawPayload: payload,
    },
  };
}

export function parseSitePayload(payload: Record<string, unknown>): CreateIntakeInput {
  const companyId = getString(payload.companyId) ?? getDefaultCompanyId();
  const url = getString(payload.url) ?? "";
  const title = getString(payload.title);
  const text = getString(payload.text) ?? getString(payload.content) ?? getString(payload.body) ?? "";

  return {
    companyId,
    sourceType: "site",
    sourceName: getString(payload.sourceName) ?? hostFromUrl(url) ?? "site_input",
    rawText: [title ? `화면: ${title}` : "", url ? `URL: ${url}` : "", "", text].filter(Boolean).join("\n"),
    receivedAt: parseDate(payload.receivedAt ?? payload.timestamp),
    metadata: {
      externalId: getString(payload.externalId),
      url,
      title,
      selector: getString(payload.selector),
      rawPayload: payload,
    },
  };
}

export function parseMessengerPayload(payload: Record<string, unknown>, provider = "kakao_work"): CreateIntakeInput {
  const companyId = getString(payload.companyId) ?? getDefaultCompanyId();
  const event = asRecord(payload.event);
  const message = asRecord(payload.message);
  const user = Object.keys(asRecord(payload.user)).length ? asRecord(payload.user) : asRecord(payload.sender);
  const channel = Object.keys(asRecord(payload.channel)).length ? asRecord(payload.channel) : asRecord(payload.room);
  const text =
    getString(payload.text) ??
    getString(payload.content) ??
    getString(payload.body) ??
    getString(message.text) ??
    getString(message.content) ??
    "";
  const senderName =
    getString(payload.senderName) ??
    getString(payload.userName) ??
    getString(user.name) ??
    getString(user.nickname);
  const externalId =
    getString(payload.messageId) ??
    getString(payload.id) ??
    getString(message.id) ??
    getString(event.id);

  return {
    companyId,
    sourceType: "messenger",
    sourceName: getString(payload.sourceName) ?? provider,
    rawText: [
      senderName ? `보낸 사람: ${senderName}` : "",
      getString(channel.name) ? `채널: ${getString(channel.name)}` : "",
      "",
      text,
    ].filter(Boolean).join("\n"),
    receivedAt: parseDate(payload.receivedAt ?? payload.timestamp ?? event.timestamp ?? message.createdAt),
    attachmentRefs: normalizeAttachmentRefs(payload.attachments ?? message.attachments ?? payload.files),
    metadata: {
      provider,
      externalId,
      senderId: getString(payload.senderId) ?? getString(user.id),
      senderName,
      channelId: getString(payload.channelId) ?? getString(channel.id),
      channelName: getString(channel.name),
      rawPayload: payload,
    },
  };
}

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function stripHtml(html: string) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAttachmentRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      name: getString(record.name) ?? getString(record.filename) ?? `attachment_${index + 1}`,
      path: getString(record.path) ?? getString(record.url),
      contentType: getString(record.contentType) ?? getString(record.mimeType),
      sizeBytes: typeof record.size === "number" ? record.size : undefined,
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hostFromUrl(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
