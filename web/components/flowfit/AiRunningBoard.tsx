"use client";

import { Activity, SearchCheck } from "lucide-react";
import * as React from "react";

import { AiRunningCard } from "@/components/flowfit/AiRunningCard";
import { FlowFitRoleControl, RestrictedEmployeeView, canUseAiOperations, useFlowFitRole } from "@/components/flowfit/flowfit-access";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { requestWorkRevision, transitionWorkStatus } from "@/services/aiWorkEngine";
import { fetchRunnerAiWorkItems, getAiWorkItems, isRunnerTaskWork, saveAiWorkItems } from "@/services/aiWorkStore";
import type { AiWorkItem } from "@/types/flowfit";

function isRunning(work: AiWorkItem) {
  return ["queued", "collecting", "analyzing", "drafting", "checking", "failed", "cancelled"].includes(work.status);
}

export function AiRunningBoard() {
  const { role, setRole } = useFlowFitRole();
  const [works, setWorks] = React.useState<AiWorkItem[]>([]);
  const [editingWork, setEditingWork] = React.useState<AiWorkItem | null>(null);
  const [instruction, setInstruction] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const loadWorks = React.useCallback(async () => {
    setLoading(true);
    try {
      const localWorks = getAiWorkItems();
      const runnerWorks = await fetchRunnerAiWorkItems().catch(() => []);
      setWorks([...runnerWorks, ...localWorks.filter((work) => !isRunnerTaskWork(work))]);
      setError("");
    } catch (err) {
      setWorks(getAiWorkItems());
      setError(err instanceof Error ? err.message : "Runner 작업을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadWorks();
    const timer = window.setInterval(() => void loadWorks(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadWorks]);

  if (!canUseAiOperations(role)) {
    return (
      <div className="space-y-4">
        <FlowFitRoleControl role={role} onChange={setRole} />
        <RestrictedEmployeeView />
      </div>
    );
  }

  const runningWorks = works.filter(isRunning);

  function commit(nextWorks: AiWorkItem[]) {
    setWorks(nextWorks);
    saveAiWorkItems(nextWorks);
  }

  function updateWork(workId: string, updater: (work: AiWorkItem) => AiWorkItem) {
    const target = works.find((work) => work.id === workId);
    if (target && isRunnerTaskWork(target)) {
      setWorks(works.map((work) => (work.id === workId ? updater(work) : work)));
      return;
    }
    commit(works.map((work) => (work.id === workId ? updater(work) : work)));
  }

  function submitInstruction() {
    if (!editingWork || !instruction.trim()) return;
    updateWork(editingWork.id, (work) => ({
      ...requestWorkRevision(work, instruction.trim()),
      status: work.type === "inventory_check" ? "drafting" : "analyzing",
    }));
    setEditingWork(null);
    setInstruction("");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-950">현재 처리 중인 업무</h1>
          <p className="mt-1 text-sm text-slate-500">Runner task와 로컬 검토용 작업을 함께 표시합니다.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void loadWorks()} disabled={loading}>
          새로고침
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-slate-950">실행 중 작업 {runningWorks.length}건</p>
              <p className="text-sm text-slate-500">완료되면 AI 작업 승인함 또는 자동 처리 기록으로 이동합니다.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <div className="space-y-4">
        {runningWorks.length ? (
          runningWorks.map((work) => (
            <AiRunningCard
              key={work.id}
              work={work}
              role={role}
              onCancel={(target) => updateWork(target.id, (item) => transitionWorkStatus(item, "cancelled"))}
              onEditInstruction={(target) => {
                setEditingWork(target);
                setInstruction("");
              }}
            />
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <SearchCheck className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-3 font-semibold text-slate-950">현재 실행 중인 AI 작업이 없습니다</p>
            <p className="mt-1 text-sm text-slate-500">운영 요청실에서 요청을 보내면 진행 단계가 여기에 표시됩니다.</p>
          </div>
        )}
      </div>

      {editingWork ? (
        <div className="sticky bottom-4 z-30 rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-400">지시 수정</p>
              <p className="text-sm font-semibold text-slate-950">{editingWork.title}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingWork(null)}>
              닫기
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="이 작업에 추가 지시하기"
              className="min-h-[80px] flex-1"
            />
            <Button type="button" className="sm:h-[80px]" onClick={submitInstruction} disabled={!instruction.trim()}>
              추가 지시 반영
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
