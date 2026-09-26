"use client";

import { AlertTriangle, CheckCircle2, ClipboardCheck, FileInput, ListChecks, MessageSquareText, Send, ShieldCheck, SlidersHorizontal } from "lucide-react";
import * as React from "react";

import type { ApprovalCardActionRequest } from "@/components/flowfit/chat/ApprovalCard";
import { MarkdownRenderer } from "@/components/flowfit/chat/MarkdownRenderer";
import { cn } from "@/lib/utils";

const structuredTypes = new Set([
  "ai_text",
  "ai_briefing",
  "ai_card_intake",
  "ai_card_approval",
  "ai_card_progress",
  "ai_card_employee_request",
  "ai_card_auto_criteria",
  "ai_card_settings_update",
  "system_event",
]);

type StructuredMessage = {
  type: string;
  payload: Record<string, unknown>;
};

type StructuredAiMessageProps = {
  message: StructuredMessage;
  onAction?: (request: ApprovalCardActionRequest) => void | Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stripJsonFence(content: string) {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : trimmed;
}

export function parseStructuredAiMessage(content: string): StructuredMessage | null {
  const candidate = stripJsonFence(content);
  if (!candidate.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(candidate);
    if (!isRecord(parsed) || !structuredTypes.has(asText(parsed.type)) || !isRecord(parsed.payload)) return null;
    return {
      type: asText(parsed.type),
      payload: parsed.payload,
    };
  } catch {
    return null;
  }
}

function actionLabel(action: string) {
  if (action === "apply_settings_update") return "설정 적용";

  const labels: Record<string, string> = {
    abort: "중단",
    accept: "수락",
    add_auto_criteria: "기준에 추가",
    approve: "승인",
    approve_send: "발송 승인",
    execute_task: "지금 실행",
    ask_employee: "직원 확인",
    edit: "수정",
    edit_then_accept: "수정 후 수락",
    hold: "보류",
    mark_complete: "완료 처리",
    modify_instructions: "지시 수정",
    preview: "미리보기",
    regenerate: "다시 생성",
    reject: "반려",
    request_employee_check: "직원 확인",
    save_as_automation: "자동화 저장",
    view_detail: "상세 보기",
  };

  return labels[action] ?? action;
}

function variantForAction(action: string) {
  if (["accept", "add_auto_criteria", "apply_settings_update", "approve", "approve_send", "execute_task", "mark_complete"].includes(action)) return "primary";
  if (["reject", "abort"].includes(action)) return "danger";
  return "secondary";
}

function ActionButtons({
  actions,
  message,
  onAction,
}: {
  actions: unknown;
  message: StructuredMessage;
  onAction?: (request: ApprovalCardActionRequest) => void | Promise<void>;
}) {
  const [pendingAction, setPendingAction] = React.useState<string | null>(null);
  const items = asArray(actions).map(asText).filter(Boolean);
  if (!items.length) return null;

  const ref =
    asText(message.payload.taskId) ||
    asText(message.payload.intakeId) ||
    asText(message.payload.requestId) ||
    asText(message.payload.module) ||
    asText(message.payload.eventType) ||
    message.type;

  async function run(action: string) {
    if (!onAction || pendingAction) return;
    setPendingAction(action);
    try {
      await onAction({
        action,
        approvalId: ref,
        label: actionLabel(action),
        payload: {
          type: message.type,
          refs: {
            taskId: message.payload.taskId,
            intakeId: message.payload.intakeId,
            requestId: message.payload.requestId,
            criterionId: message.payload.criterionId,
            module: message.payload.module,
          },
          data: message.payload,
        },
      });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {items.map((action) => (
        <button
          key={action}
          type="button"
          disabled={!onAction || Boolean(pendingAction)}
          onClick={() => void run(action)}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
            variantForAction(action) === "primary" && "bg-slate-950 text-white hover:bg-slate-800",
            variantForAction(action) === "danger" && "bg-rose-600 text-white hover:bg-rose-500",
            variantForAction(action) === "secondary" && "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-950",
          )}
        >
          <CheckCircle2 className="h-4 w-4" />
          {pendingAction === action ? "처리 중" : actionLabel(action)}
        </button>
      ))}
    </div>
  );
}

function InfoRows({ rows }: { rows: Array<{ label: string; value: string }> }) {
  if (!rows.length) return null;

  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-slate-500">{row.label}</p>
          <p className="mt-1 text-sm font-semibold text-slate-950">{row.value || "확인 필요"}</p>
        </div>
      ))}
    </div>
  );
}

function CardShell({
  badge,
  children,
  icon,
  title,
  tone = "slate",
}: {
  badge?: string;
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
  tone?: "amber" | "emerald" | "rose" | "sky" | "slate";
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border bg-white shadow-sm",
        tone === "amber" && "border-amber-200",
        tone === "emerald" && "border-emerald-200",
        tone === "rose" && "border-rose-200",
        tone === "sky" && "border-sky-200",
        tone === "slate" && "border-slate-200",
      )}
    >
      <div className="border-b border-slate-200/80 bg-slate-50/80 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">{icon}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-950">{title}</p>
              {badge ? (
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                  {badge}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function AiText({ payload }: { payload: Record<string, unknown> }) {
  return <MarkdownRenderer content={asText(payload.text) || "응답 없음"} />;
}

function Briefing({ payload }: { payload: Record<string, unknown> }) {
  return (
    <CardShell title="운영 브리핑" badge="최대 5건" icon={<ListChecks className="h-5 w-5" />} tone="sky">
      <p className="text-sm font-semibold leading-6 text-slate-950">{asText(payload.summary) || "확인이 필요한 항목입니다."}</p>
      <div className="mt-4 grid gap-2">
        {asArray(payload.items).map((item, index) => {
          const record = isRecord(item) ? item : {};
          return (
            <div key={index} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-950">{asText(record.title) || `항목 ${index + 1}`}</p>
                {asText(record.priority) ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{asText(record.priority)}</span>
                ) : null}
              </div>
              {asText(record.preview) ? <p className="mt-1 text-sm leading-6 text-slate-500">{asText(record.preview)}</p> : null}
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}

function IntakeCard({
  message,
  onAction,
}: {
  message: StructuredMessage;
  onAction?: (request: ApprovalCardActionRequest) => void | Promise<void>;
}) {
  const payload = message.payload;
  const extracted = isRecord(payload.aiExtracted) ? payload.aiExtracted : {};
  const fields = asArray(extracted.fields).map((field, index) => {
    const record = isRecord(field) ? field : {};
    const confidence = typeof record.confidence === "number" ? ` (${Math.round(record.confidence * 100)}%)` : "";
    return {
      label: asText(record.key) || `항목 ${index + 1}`,
      value: `${asText(record.value) || "확인 필요"}${confidence}`,
    };
  });
  const missing = asArray(extracted.missing ?? payload.missing).map(asText).filter(Boolean);

  return (
    <CardShell
      title={asText(payload.targetCanonical) || "접수 후보"}
      badge={`정보 등급 ${asText(payload.informationGrade) || "2"}`}
      icon={<FileInput className="h-5 w-5" />}
      tone={missing.length ? "amber" : "emerald"}
    >
      <p className="text-sm leading-6 text-slate-700">{asText(payload.rawNote) || `${asText(payload.category) || "접수"} 내용입니다.`}</p>
      <InfoRows
        rows={[
          { label: "제출자", value: asText(payload.submittedBy) },
          { label: "분류", value: asText(payload.category) },
          ...fields,
          { label: "부족한 값", value: missing.length ? missing.join(", ") : "없음" },
        ].filter((row) => row.value)}
      />
      <ActionButtons actions={payload.actions} message={message} onAction={onAction} />
    </CardShell>
  );
}

function Approval({
  message,
  onAction,
}: {
  message: StructuredMessage;
  onAction?: (request: ApprovalCardActionRequest) => void | Promise<void>;
}) {
  const payload = message.payload;
  return (
    <CardShell title={asText(payload.title) || "승인 요청"} badge={asText(payload.riskLevel)} icon={<ClipboardCheck className="h-5 w-5" />} tone="amber">
      <p className="text-sm leading-6 text-slate-700">{asText(payload.aiReason) || "사장님 확인이 필요한 작업입니다."}</p>
      <InfoRows
        rows={[
          { label: "출처", value: asText(payload.source) },
          { label: "채널", value: asText(payload.channel) || "내부" },
          { label: "초안", value: asText(payload.draftContent) },
        ].filter((row) => row.value)}
      />
      <ActionButtons actions={payload.actions} message={message} onAction={onAction} />
    </CardShell>
  );
}

function Progress({
  message,
  onAction,
}: {
  message: StructuredMessage;
  onAction?: (request: ApprovalCardActionRequest) => void | Promise<void>;
}) {
  const payload = message.payload;
  return (
    <CardShell title={asText(payload.title) || "진행 중 업무"} badge={asText(payload.currentStep)} icon={<ShieldCheck className="h-5 w-5" />} tone="sky">
      <p className="text-sm leading-6 text-slate-700">{asText(payload.expectedOutput) || "작업 진행 상태입니다."}</p>
      <div className="mt-4 grid gap-2">
        {asArray(payload.steps).map((step, index) => {
          const record = isRecord(step) ? step : {};
          return (
            <div key={index} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <span className="text-sm font-semibold text-slate-950">{asText(record.label) || `단계 ${index + 1}`}</span>
              <span className="text-xs font-semibold text-slate-500">{asText(record.status)}</span>
            </div>
          );
        })}
      </div>
      <ActionButtons actions={payload.actions} message={message} onAction={onAction} />
    </CardShell>
  );
}

function EmployeeRequest({ message }: { message: StructuredMessage }) {
  const payload = message.payload;
  const employee = isRecord(payload.targetEmployee) ? payload.targetEmployee : {};

  return (
    <CardShell title={asText(payload.title) || "직원 확인 요청"} badge={asText(payload.status)} icon={<Send className="h-5 w-5" />} tone="slate">
      <p className="text-sm leading-6 text-slate-700">{asText(payload.visibleToEmployee)}</p>
      <InfoRows
        rows={[
          { label: "대상 직원", value: asText(employee.name) },
          { label: "채널", value: asText(employee.channel) },
          { label: "사장 전용 사유", value: asText(payload.internalReason) },
          { label: "선택지", value: asArray(payload.options).map(asText).filter(Boolean).join(", ") },
        ].filter((row) => row.value)}
      />
    </CardShell>
  );
}

function AutoCriteriaCard({
  message,
  onAction,
}: {
  message: StructuredMessage;
  onAction?: (request: ApprovalCardActionRequest) => void | Promise<void>;
}) {
  const payload = message.payload;
  const keywords = asArray(payload.keywords).map(asText).filter(Boolean);
  const existingKeywords = asArray(payload.existingKeywords).map(asText).filter(Boolean);
  const autoAllowed = Boolean(payload.autoAllowed);

  return (
    <CardShell
      title="자동 처리 기준 후보"
      badge={autoAllowed ? "자동 처리" : "승인함"}
      icon={<SlidersHorizontal className="h-5 w-5" />}
      tone={autoAllowed ? "emerald" : "amber"}
    >
      <p className="text-sm leading-6 text-slate-700">{asText(payload.reason) || "채팅 내용에서 자동 처리 기준 추가 후보를 찾았습니다."}</p>
      <InfoRows
        rows={[
          { label: "분류 카테고리", value: asText(payload.criterionTitle) },
          { label: "추가할 키워드", value: keywords.join(", ") },
          { label: "현재 기준 일부", value: existingKeywords.join(", ") },
          { label: "사용자 입력", value: asText(payload.sourceText) },
        ].filter((row) => row.value)}
      />
      <ActionButtons actions={payload.actions} message={message} onAction={onAction} />
    </CardShell>
  );
}

function SettingsUpdateCard({
  message,
  onAction,
}: {
  message: StructuredMessage;
  onAction?: (request: ApprovalCardActionRequest) => void | Promise<void>;
}) {
  const payload = message.payload;
  const changes = asArray(payload.changes)
    .map((item) => (isRecord(item) ? item : null))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  return (
    <CardShell
      title={asText(payload.moduleTitle) || "설정 변경 후보"}
      badge="AI 설정 변경"
      icon={<SlidersHorizontal className="h-5 w-5" />}
      tone="amber"
    >
      <p className="text-sm leading-6 text-slate-700">
        채팅 내용에서 설정 변경 요청을 감지했습니다. 적용 전 변경값을 확인하세요.
      </p>
      <InfoRows
        rows={[
          { label: "설정 영역", value: asText(payload.moduleTitle) },
          { label: "사용자 요청", value: asText(payload.sourceText) },
          ...changes.map((change) => ({
            label: asText(change.label) || asText(change.key),
            value: `${asText(change.before) || "-"} -> ${asText(change.after) || "-"}`,
          })),
        ].filter((row) => row.value)}
      />
      <ActionButtons actions={payload.actions} message={message} onAction={onAction} />
    </CardShell>
  );
}

function SystemEvent({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
      <div className="flex items-center gap-2 font-semibold text-slate-950">
        <MessageSquareText className="h-4 w-4" />
        {asText(payload.eventType) || "system_event"}
      </div>
      <p className="mt-1">{asText(payload.summary) || "시스템 이벤트가 기록되었습니다."}</p>
    </div>
  );
}

export function StructuredAiMessage({ message, onAction }: StructuredAiMessageProps) {
  if (message.type === "ai_text") return <AiText payload={message.payload} />;
  if (message.type === "ai_briefing") return <Briefing payload={message.payload} />;
  if (message.type === "ai_card_intake") return <IntakeCard message={message} onAction={onAction} />;
  if (message.type === "ai_card_approval") return <Approval message={message} onAction={onAction} />;
  if (message.type === "ai_card_progress") return <Progress message={message} onAction={onAction} />;
  if (message.type === "ai_card_employee_request") return <EmployeeRequest message={message} />;
  if (message.type === "ai_card_auto_criteria") return <AutoCriteriaCard message={message} onAction={onAction} />;
  if (message.type === "ai_card_settings_update") return <SettingsUpdateCard message={message} onAction={onAction} />;
  if (message.type === "system_event") return <SystemEvent payload={message.payload} />;

  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
      <AlertTriangle className="mb-2 h-4 w-4" />
      알 수 없는 메시지 형식입니다.
    </div>
  );
}
