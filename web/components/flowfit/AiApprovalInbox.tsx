"use client";

import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import * as React from "react";

import { AiWorkCard } from "@/components/flowfit/AiWorkCard";
import { FlowFitRoleControl, RestrictedEmployeeView, canUseAiOperations, useFlowFitRole } from "@/components/flowfit/flowfit-access";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber } from "@/lib/utils";
import {
  approveExternalSend,
  approveWork,
  attachStaffRequest,
  attachStaffResponseToWork,
  createStaffConfirmationForWork,
  regenerateWork,
  rejectWork,
  requestWorkRevision,
  transitionWorkStatus,
} from "@/services/aiWorkEngine";
import { getAiWorkItems, saveAiWorkItems } from "@/services/aiWorkStore";
import { getStaffRequests, saveStaffRequests } from "@/services/staffRequestStore";
import type { AiWorkItem, AiWorkStatus, StaffConfirmationRequest } from "@/types/flowfit";

type ComposerMode = "revision" | "reject";
const RUNNER_APPROVAL_PREFIX = "runner-approval-";

function countByStatus(items: AiWorkItem[], status: AiWorkStatus) {
  return items.filter((item) => item.status === status).length;
}

function loadWorksWithResponses() {
  const requests = getStaffRequests();
  const works = getAiWorkItems().map((work) => {
    const request = requests.find((item) => item.id === work.assignedStaffRequestId);
    return request ? attachStaffResponseToWork(work, request) : work;
  });
  saveAiWorkItems(works);
  return { works, requests };
}

function isRunnerApprovalWork(work: AiWorkItem) {
  return work.id.startsWith(RUNNER_APPROVAL_PREFIX);
}

function getRunnerApprovalId(work: AiWorkItem) {
  return work.id.startsWith(RUNNER_APPROVAL_PREFIX) ? work.id.slice(RUNNER_APPROVAL_PREFIX.length) : null;
}

function isAiWorkItem(value: unknown): value is AiWorkItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AiWorkItem>;
  return (
    typeof item.id === "string" &&
    typeof item.companyId === "string" &&
    typeof item.title === "string" &&
    typeof item.status === "string" &&
    typeof item.approvalPolicy === "string" &&
    Array.isArray(item.steps) &&
    Array.isArray(item.instructionHistory)
  );
}

async function fetchRunnerApprovalWorks() {
  const response = await fetch("/api/runner/approvals?status=pending", { cache: "no-store" });
  if (!response.ok) return [];
  const body = (await response.json().catch(() => null)) as { aiWorkItems?: unknown[] } | null;
  return Array.isArray(body?.aiWorkItems) ? body.aiWorkItems.filter(isAiWorkItem) : [];
}

async function decideRunnerApproval(work: AiWorkItem, decision: "approve" | "reject", note?: string) {
  const approvalId = getRunnerApprovalId(work);
  if (!approvalId) return false;

  const response = await fetch(`/api/runner/approvals/${encodeURIComponent(approvalId)}/${decision}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note, resolvedBy: "owner" }),
  });
  return response.ok;
}

export function AiApprovalInbox() {
  const { role, setRole } = useFlowFitRole();
  const [works, setWorks] = React.useState<AiWorkItem[]>([]);
  const [staffRequests, setStaffRequests] = React.useState<StaffConfirmationRequest[]>([]);
  const [composer, setComposer] = React.useState<{ work: AiWorkItem; mode: ComposerMode } | null>(null);
  const [composerText, setComposerText] = React.useState("");

  React.useEffect(() => {
    let mounted = true;

    async function load() {
      const loaded = loadWorksWithResponses();
      const runnerWorks = await fetchRunnerApprovalWorks().catch(() => []);
      if (!mounted) return;
      const localWorks = loaded.works.filter((work) => !isRunnerApprovalWork(work));
      setWorks([...runnerWorks, ...localWorks]);
      setStaffRequests(loaded.requests);
    }

    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!canUseAiOperations(role)) {
    return (
      <div className="space-y-4">
        <FlowFitRoleControl role={role} onChange={setRole} />
        <RestrictedEmployeeView />
      </div>
    );
  }

  function commit(nextWorks: AiWorkItem[]) {
    setWorks(nextWorks);
    saveAiWorkItems(nextWorks.filter((work) => !isRunnerApprovalWork(work)));
  }

  function updateWork(workId: string, updater: (work: AiWorkItem) => AiWorkItem) {
    commit(works.map((work) => (work.id === workId ? updater(work) : work)));
  }

  function refreshStaffRequests(nextRequests: StaffConfirmationRequest[]) {
    setStaffRequests(nextRequests);
    saveStaffRequests(nextRequests);
  }

  async function submitComposer() {
    if (!composer || !composerText.trim()) return;
    const text = composerText.trim();
    if (isRunnerApprovalWork(composer.work)) {
      const ok = await decideRunnerApproval(
        composer.work,
        "reject",
        composer.mode === "revision" ? `수정 요청: ${text}` : text,
      );
      if (ok) {
        commit(
          works.map((work) =>
            work.id === composer.work.id
              ? rejectWork(work, composer.mode === "revision" ? `수정 요청: ${text}` : text)
              : work,
          ),
        );
      }
      setComposer(null);
      setComposerText("");
      return;
    }

    updateWork(composer.work.id, (work) =>
      composer.mode === "revision" ? requestWorkRevision(work, text) : rejectWork(work, text),
    );
    setComposer(null);
    setComposerText("");
  }

  const visibleItems = works.filter((work) => work.status === "waiting_approval" || work.status === "failed" || work.status === "cancelled");

  const summary = [
    { label: "승인 대기 중", value: countByStatus(works, "waiting_approval"), icon: Clock3, tone: "amber" },
    { label: "처리 실패", value: countByStatus(works, "failed") + countByStatus(works, "cancelled"), icon: AlertTriangle, tone: "rose" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2">
        {summary.map((item) => {
          const Icon = item.icon;
          const toneClass =
            item.tone === "amber"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-rose-200 bg-rose-50 text-rose-700";
          return (
            <Card key={item.label} className={toneClass}>
              <CardContent className="flex items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-950">{formatNumber(item.value)}</p>
                </div>
                <div className="rounded-2xl bg-white/70 p-3">
                  <Icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="space-y-4">
            {visibleItems.length ? (
              visibleItems.map((work) => (
                <AiWorkCard
                  key={work.id}
                  work={work}
                  staffRequest={staffRequests.find((request) => request.id === work.assignedStaffRequestId)}
                  onApprove={async (target) => {
                    if (isRunnerApprovalWork(target)) {
                      const ok = await decideRunnerApproval(target, "approve");
                      if (ok) updateWork(target.id, approveWork);
                      return;
                    }
                    updateWork(target.id, approveWork);
                  }}
                  onApproveSend={async (target) => {
                    if (isRunnerApprovalWork(target)) {
                      const ok = await decideRunnerApproval(target, "approve");
                      if (ok) updateWork(target.id, approveExternalSend);
                      return;
                    }
                    updateWork(target.id, approveExternalSend);
                  }}
                  onRevision={(target) => {
                    setComposer({ work: target, mode: "revision" });
                    setComposerText("");
                  }}
                  onReject={(target) => {
                      setComposer({ work: target, mode: "reject" });
                      setComposerText("");
                    }}
                  onStaffRequest={(target) => {
                    if (isRunnerApprovalWork(target)) {
                      setComposer({ work: target, mode: "revision" });
                      setComposerText("직원 확인 요청 필요");
                      return;
                    }
                    const request = createStaffConfirmationForWork(target);
                    refreshStaffRequests([request, ...staffRequests]);
                    updateWork(target.id, (work) => attachStaffRequest(work, request));
                  }}
                  onSaveAutomation={(target) =>
                    isRunnerApprovalWork(target)
                      ? setComposer({ work: target, mode: "revision" })
                      :
                    updateWork(target.id, (work) => ({
                      ...transitionWorkStatus(work, "auto_completed"),
                      resultContent: `${work.resultContent}\n\n반복 조건과 승인 정책을 설정할 자동화 초안으로 저장되었습니다.`,
                    }))
                  }
                  onComplete={async (target) => {
                    if (isRunnerApprovalWork(target)) {
                      const ok = await decideRunnerApproval(target, "approve");
                      if (ok) updateWork(target.id, approveWork);
                      return;
                    }
                    updateWork(target.id, approveWork);
                  }}
                  onRegenerate={(target) => updateWork(target.id, (work) => regenerateWork(work))}
                />
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 font-semibold text-slate-950">검토할 보류 작업이 없습니다</p>
                <p className="mt-1 text-sm text-slate-500">승인 대기 또는 처리 실패 작업이 생기면 이곳에 표시됩니다.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {composer ? (
        <div className="sticky bottom-4 z-30 rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-400">
                {composer.mode === "revision" ? "수정 요청" : "반려 사유"}
              </p>
              <p className="text-sm font-semibold text-slate-950">{composer.work.title}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setComposer(null)}>
              닫기
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              value={composerText}
              onChange={(event) => setComposerText(event.target.value)}
              placeholder={composer.mode === "revision" ? "이 작업에 대해 AI에게 수정 요청하기" : "반려 사유를 입력하세요"}
              className="min-h-[80px] flex-1"
            />
            <Button type="button" className="sm:h-[80px]" onClick={submitComposer} disabled={!composerText.trim()}>
              저장
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
