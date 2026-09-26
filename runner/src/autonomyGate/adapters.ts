// adapters.ts
// 두 세계를 GateInput으로 통일하는 변환기.
// 기본값은 전부 "보수적"이다 — 정보가 없으면 자동 전송이 안 되는 쪽으로 둔다.

import type { GateInput, RiskLevel, ApprovalPolicy } from "./types.js";

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const p = parseFloat(v);
    if (Number.isFinite(p)) return p > 1 ? p / 100 : p; // "85" → 0.85, "0.85" → 0.85
  }
  return fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Runner studioCard(aiWorkItems[]) → GateInput */
export function fromStudioCard(card: {
  id: string;
  companyId: string;
  type: string;
  riskLevel?: RiskLevel;
  approvalPolicy?: ApprovalPolicy;
  sourceSummary?: string;
  aiReasonSummary?: string;
  resultContent?: string;
  previewMessage?: string;
  metadata?: Record<string, unknown>;
}): GateInput {
  const md = card.metadata ?? {};
  return {
    source: "studio_card",
    refId: card.id,
    companyId: card.companyId,
    action: card.type,
    actionType: str(md.actionType, card.type),
    riskLevel: card.riskLevel ?? "high", // 미상이면 high → 자동 차단
    approvalPolicy: card.approvalPolicy ?? "owner_only",
    recipientKnown: bool(md.recipientKnown, false),
    reversible: bool(md.reversible, false),
    text: [card.resultContent, card.previewMessage, card.sourceSummary]
      .filter(Boolean)
      .join(" "),
    reason: card.aiReasonSummary ?? "",
    confidence: num(md.confidence, 0),
    recipientKey: str(md.recipientKey) || undefined,
    metadata: md,
  };
}

/** Runner approvals[] 레코드(options 포함) → GateInput */
export function fromApprovalRecord(approval: {
  id: string;
  companyId: string;
  title: string;
  description?: string;
  riskLevel?: RiskLevel;
  options?: {
    action?: string;
    reason?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  };
  studioCard?: { approvalPolicy?: ApprovalPolicy; riskLevel?: RiskLevel };
}): GateInput {
  const opt = approval.options ?? {};
  const md = opt.metadata ?? {};
  const risk = approval.riskLevel ?? approval.studioCard?.riskLevel ?? "high";
  return {
    source: "runner_approval",
    refId: approval.id,
    companyId: approval.companyId,
    action: str(opt.action, "unknown"),
    actionType: str(md.actionType, str(opt.action, "unknown")),
    riskLevel: risk,
    approvalPolicy: approval.studioCard?.approvalPolicy ?? "owner_only",
    recipientKnown: bool(md.recipientKnown, false),
    reversible: bool(md.reversible, false),
    text: [approval.title, approval.description, opt.reason].filter(Boolean).join(" "),
    reason: str(opt.reason),
    confidence: num(md.confidence, 0),
    recipientKey: str(md.recipientKey) || undefined,
    metadata: md,
  };
}

/** Runner에 보내기 직전의 CreateApprovalRequestInput → GateInput (생성 시점 게이트) */
export function fromCreateInput(input: {
  companyId: string;
  taskId?: string;
  runId?: string;
  action: string;
  reason: string;
  title?: string;
  description?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  riskLevel?: RiskLevel;
  approvalPolicy?: ApprovalPolicy;
}): GateInput {
  const md = input.metadata ?? {};
  return {
    source: "runner_approval",
    refId: input.taskId ?? input.runId ?? `${input.companyId}:${input.action}`,
    companyId: input.companyId,
    action: input.action,
    actionType: str(md.actionType, input.action),
    riskLevel: input.riskLevel ?? "high",
    approvalPolicy: input.approvalPolicy ?? "owner_only",
    recipientKnown: bool(md.recipientKnown, false),
    reversible: bool(md.reversible, false),
    text: [input.title, input.description, input.reason].filter(Boolean).join(" "),
    reason: input.reason,
    confidence: num(md.confidence, 0),
    recipientKey: str(md.recipientKey) || undefined,
    metadata: md,
  };
}
