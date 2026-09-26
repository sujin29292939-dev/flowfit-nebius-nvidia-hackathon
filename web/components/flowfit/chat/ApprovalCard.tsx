"use client";

import { AlertTriangle, CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type ApprovalCardRow = {
  label: string;
  from?: string;
  to?: string;
  value?: string;
};

type ApprovalCardAction = {
  action?: string;
  href?: string;
  label: string;
  payload?: Record<string, unknown>;
  variant?: "primary" | "secondary" | "danger";
};

export type ApprovalCardActionRequest = {
  action: string;
  approvalId?: string;
  label: string;
  payload?: Record<string, unknown>;
};

export type ApprovalCardPayload = {
  actions?: ApprovalCardAction[];
  approvalId?: string;
  description?: string;
  fields?: ApprovalCardRow[];
  module?: string;
  risk?: string;
  status?: string;
  subtitle?: string;
  summary?: string;
  title?: string;
  type: "approval_card";
  changes?: ApprovalCardRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function readString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
}

function normalizeRows(value: unknown): ApprovalCardRow[] {
  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        if (!isRecord(item)) {
          return { label: `항목 ${index + 1}`, value: stringifyValue(item) };
        }

        return {
          label: readString(item, ["label", "field", "name", "title", "key"]) ?? `항목 ${index + 1}`,
          from: readString(item, ["from", "oldValue", "before", "previous"]),
          to: readString(item, ["to", "newValue", "after", "next"]),
          value: readString(item, ["value", "current", "setting"]),
        };
      })
      .filter((item) => item.label || item.value || item.from || item.to);
  }

  if (isRecord(value)) {
    return Object.entries(value).map(([key, item]) => ({
      label: key,
      value: stringifyValue(item),
    }));
  }

  return [];
}

function normalizeActions(value: unknown): ApprovalCardAction[] {
  if (!Array.isArray(value)) return [];

  const actions: ApprovalCardAction[] = [];

  for (const item of value) {
    if (typeof item === "string") {
      actions.push({ label: item });
      continue;
    }

    if (!isRecord(item)) continue;

    const variant = readString(item, ["variant", "tone"]);
    actions.push({
      action: readString(item, ["action", "id", "value"]),
      href: readString(item, ["href", "url", "actionUrl"]),
      label: readString(item, ["label", "title", "name"]) ?? "실행",
      payload: isRecord(item.payload) ? item.payload : undefined,
      variant: variant === "primary" || variant === "danger" || variant === "secondary" ? variant : "secondary",
    });
  }

  return actions;
}

function normalizePayload(value: Record<string, unknown>): ApprovalCardPayload {
  return {
    actions: normalizeActions(value.actions),
    approvalId: readString(value, ["approvalId", "approval_id", "id"]),
    changes: normalizeRows(value.changes),
    description: readString(value, ["description", "body"]),
    fields: normalizeRows(value.fields),
    module: readString(value, ["module", "target", "category"]),
    risk: readString(value, ["risk", "riskLevel", "risk_level"]),
    status: readString(value, ["status", "state"]),
    subtitle: readString(value, ["subtitle", "eyebrow"]),
    summary: readString(value, ["summary", "message"]),
    title: readString(value, ["title", "name"]),
    type: "approval_card",
  };
}

function stripJsonFence(content: string) {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : trimmed;
}

export function parseApprovalCardContent(content: string): ApprovalCardPayload | null {
  const candidate = stripJsonFence(content);
  if (!candidate.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(candidate);
    if (!isRecord(parsed) || parsed.type !== "approval_card") return null;
    return normalizePayload(parsed);
  } catch {
    return null;
  }
}

function actionClassName(variant?: ApprovalCardAction["variant"]) {
  if (variant === "primary") return "bg-slate-950 text-white hover:bg-slate-800";
  if (variant === "danger") return "bg-rose-600 text-white hover:bg-rose-500";
  return "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-950";
}

export function ApprovalCard({
  onAction,
  payload,
}: {
  onAction?: (request: ApprovalCardActionRequest) => void | Promise<void>;
  payload: ApprovalCardPayload;
}) {
  const rows = [...(payload.changes ?? []), ...(payload.fields ?? [])];
  const [pendingAction, setPendingAction] = React.useState<string | null>(null);

  async function runAction(action: ApprovalCardAction) {
    if (!action.action || pendingAction) return;

    setPendingAction(action.action);
    try {
      await onAction?.({
        action: action.action,
        approvalId: payload.approvalId,
        label: action.label,
        payload: action.payload,
      });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/50 shadow-sm">
      <div className="border-b border-amber-200/80 bg-white/80 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-950">{payload.title ?? "승인 요청"}</p>
              {payload.status ? (
                <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  {payload.status}
                </span>
              ) : null}
              {payload.risk ? (
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                  {payload.risk}
                </span>
              ) : null}
            </div>
            {payload.subtitle || payload.module ? (
              <p className="mt-1 text-xs font-medium text-slate-500">{payload.subtitle ?? payload.module}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {payload.summary || payload.description ? (
          <div className="rounded-xl border border-amber-100 bg-white/80 p-3 text-sm leading-6 text-slate-700">
            {payload.summary ? <p className="font-semibold text-slate-950">{payload.summary}</p> : null}
            {payload.description ? <p className={cn(payload.summary && "mt-1")}>{payload.description}</p> : null}
          </div>
        ) : null}

        {rows.length ? (
          <div className="grid gap-2">
            {rows.map((row, index) => (
              <div key={`${row.label}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-500">{row.label}</p>
                {row.from || row.to ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-500">{row.from || "이전 값 없음"}</span>
                    <span className="text-slate-400">→</span>
                    <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700">{row.to || "변경 값 없음"}</span>
                  </div>
                ) : (
                  <p className="mt-1 text-sm font-semibold text-slate-950">{row.value || "확인 필요"}</p>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {payload.approvalId ? (
          <div className="flex items-center gap-2 rounded-xl bg-white/80 px-3 py-2 text-xs font-medium text-slate-500">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            <span className="truncate">승인 ID: {payload.approvalId}</span>
          </div>
        ) : null}

        {payload.actions?.length ? (
          <div className="flex flex-wrap gap-2">
            {payload.actions.map((action, index) =>
              action.href ? (
                <a
                  key={`${action.label}-${index}`}
                  href={action.href}
                  className={cn("inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition", actionClassName(action.variant))}
                >
                  {action.variant === "danger" ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  {action.label}
                </a>
              ) : (
                <button
                  key={`${action.label}-${index}`}
                  type="button"
                  disabled={!action.action || !onAction || Boolean(pendingAction)}
                  onClick={() => void runAction(action)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
                    actionClassName(action.variant),
                  )}
                >
                  {action.variant === "danger" ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  {pendingAction === action.action ? "처리 중" : action.label}
                </button>
              ),
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
