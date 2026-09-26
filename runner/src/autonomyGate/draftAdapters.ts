// draftAdapters.ts
// 실제 AI 출력(drafter.ts 역할)을 GateInput으로 정규화한다.
//   - TaskUnderstandingResult (understanding/types.ts)
//   - ApprovalDraftPayload   (operationChatAi.ts)
// 보수적 기본값: 정보가 없으면 자동 전송이 막히는 쪽으로 둔다.

import type { GateInput, RiskLevel } from "./types.js";

// ── 상류 타입 미러 (실제 코드의 타입을 그대로 반영) ───────────────────────────

export type BusinessTaskType =
  | "order_request" | "quote_request" | "delivery_inquiry" | "payment_report"
  | "reply_draft" | "complaint" | "automation_request" | "report_request"
  | "general_request" | "unknown";

export type BusinessRiskLevel = "low" | "medium" | "high" | "uncertain";

export interface ExtractedBusinessFields {
  customerName?: string; itemName?: string; quantity?: number; unit?: string;
  dueDateText?: string; deliveryAddress?: string; orderNumber?: string;
  trackingNumber?: string; amount?: number; depositorName?: string;
  contactName?: string; requestedReplyChannel?: string;
}

export interface TaskUnderstandingResult {
  taskType: BusinessTaskType;
  title: string;
  summary: string;
  fields: ExtractedBusinessFields;
  missingFields: string[];
  confidence: number;
  riskLevel: BusinessRiskLevel;
  recommendedAction: string;
  evidence: string[];
  needsHumanReview: boolean;
  engine: "llm" | "heuristic";
}

export interface ApprovalDraftPayload {
  taskId?: string;
  title: string;
  source: string;
  riskLevel: "low" | "medium" | "high" | "requires_check";
  aiReason: string;
  draftContent: string;
  channel: "문자" | "이메일" | "슬랙" | null;
  actions: Array<
    | "approve_send" | "edit" | "reject" | "request_employee_check"
    | "save_as_automation" | "mark_complete" | "regenerate"
  >;
}

// ── 보조 ────────────────────────────────────────────────────────────────────

/** "uncertain"/"requires_check"는 강제 검토. 나머지는 그대로. */
function normalizeRisk(r: BusinessRiskLevel | ApprovalDraftPayload["riskLevel"]): {
  riskLevel: RiskLevel;
  forceReview: boolean;
} {
  if (r === "uncertain" || r === "requires_check") return { riskLevel: "high", forceReview: true };
  return { riskLevel: r, forceReview: false };
}

/** 초안 채널(한글/staff enum) → 전송 채널 + 전송체 */
export function mapChannel(channel: string | null | undefined): {
  channel: string;
  transport: "kakao_notify" | "staff_channel";
} {
  switch (channel) {
    case "kakao":
    case "카카오":
      return { channel: "kakao", transport: "kakao_notify" };
    case "문자":
    case "sms":
      return { channel: "sms", transport: "staff_channel" };
    case "이메일":
    case "email":
      return { channel: "email", transport: "staff_channel" };
    case "슬랙":
    case "slack":
      return { channel: "slack", transport: "staff_channel" };
    default:
      return { channel: channel ?? "manual", transport: "staff_channel" };
  }
}

export interface AdapterOptions {
  companyId: string;
  refId: string;
  /** 거래처명이 검증된 기존 거래처인지 판정 (없으면 미검증으로 봄) */
  isKnownAccount?: (customerName?: string) => boolean;
  /** 되돌릴 수 있는 액션 유형 집합 (회수 창 내 취소 가능) */
  reversibleActionTypes?: Set<string>;
  /** 추가 메타데이터 (deviceId, recipientKey 등) */
  metadata?: Record<string, unknown>;
}

const DEFAULT_REVERSIBLE = new Set([
  "reply_draft", "reply_send", "delivery_alert", "dunning_reminder", "report_request",
]);

// ── 어댑터 ──────────────────────────────────────────────────────────────────

/** Runner 업무 이해 결과 → GateInput */
export function fromUnderstanding(
  result: TaskUnderstandingResult,
  opts: AdapterOptions,
): GateInput {
  const { riskLevel, forceReview } = normalizeRisk(result.riskLevel);
  const reversibleSet = opts.reversibleActionTypes ?? DEFAULT_REVERSIBLE;
  const recipientKnown = opts.isKnownAccount
    ? opts.isKnownAccount(result.fields.customerName)
    : false;
  const channelInfo = mapChannel(result.fields.requestedReplyChannel);
  return {
    source: "runner_approval",
    refId: opts.refId,
    companyId: opts.companyId,
    action: result.taskType,
    actionType: result.taskType,
    riskLevel,
    approvalPolicy: "approval_required",
    recipientKnown,
    reversible: reversibleSet.has(result.taskType),
    text: [result.title, result.summary, result.recommendedAction, ...result.evidence].join(" "),
    reason: result.recommendedAction,
    confidence: result.confidence,
    recipientKey: result.fields.customerName,
    // needsHumanReview / uncertain → 강제 검토
    forceReview: forceReview || result.needsHumanReview,
    metadata: {
      ...opts.metadata,
      ...channelInfo,
      taskType: result.taskType,
      missingFields: result.missingFields,
      presentFields: Object.entries(result.fields)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k]) => k),
      amount: result.fields.amount,
      engine: result.engine,
    },
  };
}

/** 채팅 승인 카드 초안 → GateInput */
export function fromApprovalDraft(
  payload: ApprovalDraftPayload,
  opts: AdapterOptions,
): GateInput {
  const { riskLevel, forceReview } = normalizeRisk(payload.riskLevel);
  const channelInfo = mapChannel(payload.channel);
  const reversibleSet = opts.reversibleActionTypes ?? DEFAULT_REVERSIBLE;
  // approve_send 액션이 없으면 전송 대상이 아니다 → 강제 검토
  const isSendable = payload.actions.includes("approve_send");
  const actionType = (opts.metadata?.actionType as string) ?? payload.source ?? "reply_draft";
  const recipientKey = opts.metadata?.recipientKey as string | undefined;
  const recipientKnown =
    opts.metadata?.recipientKnown === true ||
    (!!recipientKey && (opts.isKnownAccount ? opts.isKnownAccount(recipientKey) : false));
  return {
    source: "chat_card",
    refId: opts.refId ?? payload.taskId ?? payload.title,
    companyId: opts.companyId,
    action: "approve_send",
    actionType,
    riskLevel,
    approvalPolicy: "approval_required",
    recipientKnown,
    reversible: reversibleSet.has(actionType),
    text: [payload.title, payload.aiReason, payload.draftContent].join(" "),
    reason: payload.aiReason,
    confidence: (opts.metadata?.confidence as number) ?? 0,
    recipientKey,
    forceReview: forceReview || !isSendable,
    metadata: { ...opts.metadata, ...channelInfo, draftContent: payload.draftContent },
  };
}
