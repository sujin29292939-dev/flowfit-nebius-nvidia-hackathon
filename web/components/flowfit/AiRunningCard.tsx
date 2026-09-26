"use client";

import { ChevronDown, ChevronUp, Clock3, Eye, Loader2, PauseCircle, PencilLine } from "lucide-react";
import * as React from "react";

import { ExecutionPreview } from "@/components/flowfit/ExecutionPreview";
import {
  aiWorkStatusLabels,
  aiWorkTypeLabels,
  getStatusVariant,
  stepStatusLabels,
} from "@/components/flowfit/flowfit-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatDateTime } from "@/lib/utils";
import type { AiWorkItem, UserRole } from "@/types/flowfit";

function stepClass(status: AiWorkItem["steps"][number]["status"]) {
  if (status === "done") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "running") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function isStopped(status: AiWorkItem["status"]) {
  return status === "cancelled" || status === "failed";
}

export function AiRunningCard({
  work,
  role,
  onCancel,
  onEditInstruction,
}: {
  work: AiWorkItem;
  role: UserRole;
  onCancel: (work: AiWorkItem) => void;
  onEditInstruction: (work: AiWorkItem) => void;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const runningStep = work.steps.find((step) => step.status === "running");
  const currentStep = isStopped(work.status) ? aiWorkStatusLabels[work.status] : runningStep?.label ?? aiWorkStatusLabels[work.status];
  const canSeePreview = role === "owner" || role === "manager";

  return (
    <article className={cn("rounded-3xl border bg-white p-5 shadow-panel", isStopped(work.status) ? "border-rose-200" : "border-slate-200")}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getStatusVariant(work.status)}>
              {!isStopped(work.status) ? <span className="mr-1.5 h-2 w-2 rounded-full bg-current opacity-70 animate-pulse" /> : null}
              {aiWorkStatusLabels[work.status]}
            </Badge>
            <Badge>{aiWorkTypeLabels[work.type]}</Badge>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500">
              출처: {work.sourceSummary}
            </span>
          </div>
          <h2 className="mt-3 text-xl font-semibold text-slate-950">{work.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">현재 단계: {currentStep}</p>
        </div>

        <div className="grid gap-2 text-sm lg:w-[21rem]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-400">예상 결과</p>
            <p className="mt-1 font-medium text-slate-900">{work.resultTitle}</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-700">검토 필요성</p>
            <p className="mt-1 font-medium text-amber-950">{work.previewMessage ?? work.aiReasonSummary}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {work.steps.map((step) => (
          <div key={step.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2">
            <span className={cn("mt-0.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", stepClass(step.status))}>
              {stepStatusLabels[step.status]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800">{step.label}</p>
              {step.summary ? <p className="mt-1 text-xs text-slate-500">{step.summary}</p> : null}
            </div>
            {step.status === "running" && !isStopped(work.status) ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-sky-500" /> : null}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 text-sm md:grid-cols-2">
        <div className="flex items-center gap-2 text-slate-500">
          <Clock3 className="h-4 w-4" />
          작업 시작: {formatDateTime(work.createdAt)}
        </div>
        <div className="flex items-center gap-2 text-slate-500">
          <Clock3 className="h-4 w-4" />
          마지막 업데이트: {formatDateTime(work.updatedAt)}
        </div>
      </div>

      {detailsOpen ? (
        <div className="mt-5 grid gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-2">
          <DetailBlock title="입력 데이터 요약" body={work.sourceSummary} />
          <DetailBlock title="확인한 출처" body={`${work.sourceSummary}, 관련 내부 기록`} />
          <DetailBlock title="AI가 확인한 핵심 항목" body={work.aiReasonSummary} />
          <DetailBlock title="생성 예정 결과" body={work.resultTitle} />
          <DetailBlock title="위험 판단 이유" body={work.previewMessage ?? work.aiReasonSummary} />
          <DetailBlock title="다음 실행 단계" body={runningStep ? `${runningStep.label} 이후 승인함으로 이동합니다.` : "결과 검토 대기 상태로 이동합니다."} />
        </div>
      ) : null}

      {previewOpen && canSeePreview ? (
        <div className="mt-5">
          <ExecutionPreview preview={work.executionPreview} />
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onCancel(work)} disabled={work.status === "cancelled"}>
          <PauseCircle className="h-4 w-4" />
          작업 중단
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onEditInstruction(work)}>
          <PencilLine className="h-4 w-4" />
          지시 수정
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setDetailsOpen((current) => !current)}>
          {detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          상세 보기
        </Button>
        {canSeePreview ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen((current) => !current)}>
            <Eye className="h-4 w-4" />
            실행 미리보기
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function DetailBlock({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{title}</p>
      <p className="mt-2 rounded-2xl bg-white px-3 py-2 text-sm leading-6 text-slate-700 whitespace-pre-line">{body}</p>
    </div>
  );
}

