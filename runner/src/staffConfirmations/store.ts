import { randomUUID } from "node:crypto";

import { isDatabaseConfigured, sql } from "../db/client.js";
import type {
  CreateStaffConfirmationRequestInput,
  StaffConfirmationRequestRecord,
  StaffRequestChannel,
  StaffRequestStatus,
} from "./types.js";

type DbRow = {
  id: string;
  company_id: string;
  ai_work_id: string | null;
  requested_by_user_id: string | null;
  requested_by_name: string | null;
  staff_id: string | null;
  staff_name: string;
  staff_contact: string | null;
  channel: string;
  status: string;
  title: string;
  question: string;
  response_options_json: unknown;
  message_preview: string;
  internal_reason: string;
  sent_at: string | null;
  responded_at: string | null;
  response: string | null;
  response_memo: string | null;
  external_message_id: string | null;
  created_at: string;
  updated_at: string;
};

const memoryRequests = new Map<string, StaffConfirmationRequestRecord>();

const seed: StaffConfirmationRequestRecord = {
  id: "staff-request-order-a",
  companyId: "flowfit-demo",
  aiWorkId: "ai-work-order-missing-approval",
  requestedByUserId: "owner-demo",
  requestedByName: "대표",
  staffId: "staff-kim",
  staffName: "김직원",
  staffContact: "010-1234-5678",
  channel: "manual",
  status: "sent",
  title: "A거래처 발주 접수 여부 확인",
  question: "A거래처 발주가 오늘 접수되었는지 확인해주세요.",
  responseOptions: ["접수됨", "미접수", "확인 중"],
  messagePreview:
    "[FlowFit 확인 요청 · 대표 요청]\n\nA거래처 발주 접수 여부 확인\n\n확인할 내용:\nA거래처 발주가 오늘 접수되었는지 확인해주세요.\n\n응답:\n[접수됨] [미접수] [확인 중]",
  internalReason: "발주 누락 가능성이 있어 담당 직원 확인이 필요합니다.",
  sentAt: "2026-04-28T16:50:00+09:00",
  externalMessageId: "mock-staff-request-order-a",
  createdAt: "2026-04-28T16:45:00+09:00",
  updatedAt: "2026-04-28T16:50:00+09:00",
};

memoryRequests.set(seed.id, seed);

export async function listStaffConfirmationRequests(input: {
  companyId?: string;
  status?: string;
  limit?: number;
} = {}) {
  const limit = clampLimit(input.limit);
  if (!isDatabaseConfigured()) {
    return Array.from(memoryRequests.values())
      .filter((item) => !input.companyId || item.companyId === input.companyId)
      .filter((item) => !input.status || item.status === input.status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  const rows = await sql`
    SELECT *
    FROM staff_confirmation_requests
    WHERE (${input.companyId ?? null}::text IS NULL OR company_id = ${input.companyId ?? null})
      AND (${input.status ?? null}::text IS NULL OR status = ${input.status ?? null})
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
  return rows.map(rowToRecord);
}

export async function createStaffConfirmationRequest(input: CreateStaffConfirmationRequestInput) {
  const now = new Date().toISOString();
  const request: StaffConfirmationRequestRecord = {
    id: input.id ?? `staff-request-${randomUUID()}`,
    companyId: input.companyId ?? "company_demo",
    aiWorkId: input.aiWorkId ?? "",
    requestedByUserId: input.requestedByUserId ?? "owner",
    requestedByName: input.requestedByName ?? "대표",
    staffId: input.staffId,
    staffName: input.staffName,
    staffContact: input.staffContact,
    channel: input.channel ?? "manual",
    status: input.status ?? "waiting_approval",
    title: input.title,
    question: input.question,
    responseOptions: input.responseOptions?.length ? input.responseOptions : ["확인", "보류"],
    messagePreview: input.messagePreview ?? buildMessagePreview(input.title, input.question, input.responseOptions),
    internalReason: input.internalReason,
    createdAt: now,
    updatedAt: now,
  };

  if (!isDatabaseConfigured()) {
    memoryRequests.set(request.id, request);
    return request;
  }

  await sql`
    INSERT INTO staff_confirmation_requests (
      id, company_id, ai_work_id, requested_by_user_id, requested_by_name,
      staff_id, staff_name, staff_contact, channel, status, title, question,
      response_options_json, message_preview, internal_reason, created_at, updated_at
    )
    VALUES (
      ${request.id}, ${request.companyId}, ${request.aiWorkId}, ${request.requestedByUserId}, ${request.requestedByName},
      ${request.staffId ?? null}, ${request.staffName}, ${request.staffContact ?? null}, ${request.channel}, ${request.status},
      ${request.title}, ${request.question}, ${JSON.stringify(request.responseOptions)}, ${request.messagePreview},
      ${request.internalReason}, ${request.createdAt}, ${request.updatedAt}
    )
  `;
  return request;
}

export async function markStaffConfirmationSent(id: string) {
  const now = new Date().toISOString();
  const externalMessageId = `mock-${id}`;
  if (!isDatabaseConfigured()) {
    const current = assertMemoryRequest(id);
    const next: StaffConfirmationRequestRecord = {
      ...current,
      status: "sent",
      externalMessageId,
      sentAt: now,
      updatedAt: now,
    };
    memoryRequests.set(id, next);
    return next;
  }

  const rows = await sql`
    UPDATE staff_confirmation_requests
    SET status = 'sent',
        external_message_id = ${externalMessageId},
        sent_at = ${now},
        updated_at = ${now}
    WHERE id = ${id}
    RETURNING *
  `;
  if (!rows[0]) throw new Error(`Staff confirmation request not found: ${id}`);
  return rowToRecord(rows[0]);
}

export async function respondStaffConfirmationRequest(input: {
  id: string;
  response: string;
  responseMemo?: string;
}) {
  const now = new Date().toISOString();
  if (!isDatabaseConfigured()) {
    const current = assertMemoryRequest(input.id);
    const next: StaffConfirmationRequestRecord = {
      ...current,
      status: "responded",
      response: input.response,
      responseMemo: input.responseMemo,
      respondedAt: now,
      updatedAt: now,
    };
    memoryRequests.set(input.id, next);
    return next;
  }

  const rows = await sql`
    UPDATE staff_confirmation_requests
    SET status = 'responded',
        response = ${input.response},
        response_memo = ${input.responseMemo ?? null},
        responded_at = ${now},
        updated_at = ${now}
    WHERE id = ${input.id}
    RETURNING *
  `;
  if (!rows[0]) throw new Error(`Staff confirmation request not found: ${input.id}`);
  return rowToRecord(rows[0]);
}

function assertMemoryRequest(id: string) {
  const current = memoryRequests.get(id);
  if (!current) throw new Error(`Staff confirmation request not found: ${id}`);
  return current;
}

function rowToRecord(row: DbRow): StaffConfirmationRequestRecord {
  const options = Array.isArray(row.response_options_json)
    ? row.response_options_json.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id: row.id,
    companyId: row.company_id,
    aiWorkId: row.ai_work_id ?? "",
    requestedByUserId: row.requested_by_user_id ?? "owner",
    requestedByName: row.requested_by_name ?? "대표",
    staffId: row.staff_id ?? undefined,
    staffName: row.staff_name,
    staffContact: row.staff_contact ?? undefined,
    channel: normalizeChannel(row.channel),
    status: normalizeStatus(row.status),
    title: row.title,
    question: row.question,
    responseOptions: options,
    messagePreview: row.message_preview,
    internalReason: row.internal_reason,
    sentAt: row.sent_at ?? undefined,
    respondedAt: row.responded_at ?? undefined,
    response: row.response ?? undefined,
    responseMemo: row.response_memo ?? undefined,
    externalMessageId: row.external_message_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildMessagePreview(title: string, question: string, options?: string[]) {
  const responseOptions = options?.length ? options : ["확인", "보류"];
  return `[FlowFit 확인 요청 · 대표 요청]\n\n${title}\n\n확인할 내용:\n${question}\n\n응답:\n${responseOptions.map((item) => `[${item}]`).join(" ")}`;
}

function normalizeChannel(value: string): StaffRequestChannel {
  if (["sms", "email", "slack", "teams", "kakao_work", "telegram", "manual"].includes(value)) {
    return value as StaffRequestChannel;
  }
  return "manual";
}

function normalizeStatus(value: string): StaffRequestStatus {
  if (["draft", "waiting_approval", "sent", "responded", "expired", "cancelled"].includes(value)) {
    return value as StaffRequestStatus;
  }
  return "draft";
}

function clampLimit(value: number | undefined) {
  const limit = Number(value ?? 50);
  if (!Number.isFinite(limit)) return 50;
  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}
