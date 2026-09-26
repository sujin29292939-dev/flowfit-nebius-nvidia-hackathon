"use client";

import {
  CheckCircle2,
  MessageSquarePlus,
  PencilLine,
  RefreshCcw,
  Send,
  ShieldCheck,
  UserRoundCheck,
  XCircle,
} from "lucide-react";

import {
  aiWorkStatusLabels,
  aiWorkTypeLabels,
  approvalPolicyLabels,
  getRiskVariant,
  getStatusVariant,
  riskLevelLabels,
} from "@/components/flowfit/flowfit-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import type { AiWorkItem, StaffConfirmationRequest } from "@/types/flowfit";

export function AiWorkCard({
  work,
  staffRequest,
  onApprove,
  onApproveSend,
  onRevision,
  onReject,
  onStaffRequest,
  onSaveAutomation,
  onComplete,
  onRegenerate,
}: {
  work: AiWorkItem;
  staffRequest?: StaffConfirmationRequest;
  onApprove: (work: AiWorkItem) => void;
  onApproveSend: (work: AiWorkItem) => void;
  onRevision: (work: AiWorkItem) => void;
  onReject: (work: AiWorkItem) => void;
  onStaffRequest: (work: AiWorkItem) => void;
  onSaveAutomation: (work: AiWorkItem) => void;
  onComplete: (work: AiWorkItem) => void;
  onRegenerate: (work: AiWorkItem) => void;
}) {
  const isExternalMessage = work.type === "customer_reply" || work.type === "external_message";
  const isDone = work.status === "completed" || work.status === "auto_completed" || work.status === "cancelled";

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getStatusVariant(work.status)}>{aiWorkStatusLabels[work.status]}</Badge>
            <Badge>{aiWorkTypeLabels[work.type]}</Badge>
            <Badge variant={getRiskVariant(work.riskLevel)}>위험도 {riskLevelLabels[work.riskLevel]}</Badge>
          </div>
          <h2 className="mt-3 text-xl font-semibold text-slate-950">{work.title}</h2>
          <p className="mt-2 text-sm text-slate-500">출처: {work.sourceSummary}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm lg:w-[21rem]">
          <p className="text-xs font-semibold text-slate-400">승인 정책</p>
          <p className="mt-1 font-semibold text-slate-900">{approvalPolicyLabels[work.approvalPolicy]}</p>
          <p className="mt-2 text-xs text-slate-500">생성 {formatDateTime(work.createdAt)}</p>
          <p className="mt-1 text-xs text-slate-500">업데이트 {formatDateTime(work.updatedAt)}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-400">AI 판단 요약</p>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{work.aiReasonSummary}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold text-slate-400">생성 결과물</p>
          <p className="mt-1 font-semibold text-slate-950">{work.resultTitle}</p>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{work.resultContent}</p>
        </div>
      </div>

      {staffRequest?.status === "responded" ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold text-emerald-700">직원 응답 회수</p>
          <p className="mt-2 text-sm font-semibold text-emerald-950">
            {staffRequest.staffName}: {staffRequest.response}
          </p>
          {staffRequest.responseMemo ? <p className="mt-1 text-sm text-emerald-900">{staffRequest.responseMemo}</p> : null}
        </div>
      ) : null}

      {work.instructionHistory.length ? (
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <p className="text-xs font-semibold text-sky-700">수정/반려 기록</p>
          <div className="mt-2 space-y-1">
            {work.instructionHistory.slice(-3).map((instruction) => (
              <p key={instruction.id} className="text-sm leading-6 text-sky-950">
                {instruction.userName}: {instruction.instruction}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {!isExternalMessage ? (
          <Button type="button" size="sm" onClick={() => onApprove(work)} disabled={isDone}>
            <CheckCircle2 className="h-4 w-4" />
            승인
          </Button>
        ) : null}
        {isExternalMessage ? (
          <Button type="button" size="sm" onClick={() => onApproveSend(work)} disabled={isDone}>
            <Send className="h-4 w-4" />
            발송 승인
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => onRevision(work)} disabled={work.status === "cancelled"}>
          <PencilLine className="h-4 w-4" />
          수정 요청
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onReject(work)} disabled={isDone}>
          <XCircle className="h-4 w-4" />
          반려
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onStaffRequest(work)} disabled={isDone}>
          <UserRoundCheck className="h-4 w-4" />
          직원 확인 요청
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onSaveAutomation(work)} disabled={isDone}>
          <ShieldCheck className="h-4 w-4" />
          자동화로 저장
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onComplete(work)} disabled={isDone}>
          <CheckCircle2 className="h-4 w-4" />
          완료 처리
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onRegenerate(work)}>
          <RefreshCcw className="h-4 w-4" />
          다시 생성
        </Button>
        {staffRequest && staffRequest.status !== "responded" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700">
            <MessageSquarePlus className="h-3.5 w-3.5" />
            직원 확인 요청 준비됨
          </span>
        ) : null}
      </div>
    </article>
  );
}

