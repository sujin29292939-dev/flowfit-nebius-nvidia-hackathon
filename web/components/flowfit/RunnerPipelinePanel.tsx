"use client";

import { DatabaseZap, GitBranch, History, Play, RefreshCw, SendHorizonal } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type RunnerIntake = {
  id?: string;
  source_type?: string;
  source_name?: string | null;
  raw_text?: string | null;
  status?: string;
  received_at?: string;
  created_at?: string;
};

type RunnerTask = {
  id?: string;
  task_type?: string;
  status?: string;
  confidence?: number;
  risk_level?: string;
  context_status?: string;
  due_at?: string | null;
  extracted_fields_json?: Record<string, unknown>;
  updated_at?: string;
};

type RunnerTimelineItem = {
  id?: string;
  source?: string;
  type?: string;
  at?: string;
  title?: string;
  data?: Record<string, unknown>;
};

type PipelineState = {
  intakes: RunnerIntake[];
  tasks: RunnerTask[];
  error: string;
};

type AiRuntime = {
  status: "live" | "configured" | "not_configured";
  provider: string;
  model: string;
  route: string | null;
  latencyMs: number | null;
  lastSuccessAt: string | null;
  successCount: number;
  prototype: boolean;
};

const SAMPLE_TEXT = "A거래처에서 멸균 장갑 20박스를 내일 오전까지 견적 요청. 담당자는 김민수, 회신은 문자로 부탁.";

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function getTaskTitle(task: RunnerTask) {
  const fields = task.extracted_fields_json ?? {};
  return String(fields.title ?? fields.summary ?? task.task_type ?? "AI 분류 작업");
}

function getTaskSummary(task: RunnerTask) {
  const fields = task.extracted_fields_json ?? {};
  return String(fields.summary ?? fields.recommendedAction ?? "수집 원문을 AI가 업무 후보로 구조화했습니다.");
}

function getTaskDecision(task: RunnerTask) {
  const decision = task.extracted_fields_json?.decision;
  return decision && typeof decision === "object" && !Array.isArray(decision)
    ? decision as Record<string, unknown>
    : null;
}

export function RunnerPipelinePanel() {
  const [state, setState] = React.useState<PipelineState>({ intakes: [], tasks: [], error: "" });
  const [runtime, setRuntime] = React.useState<AiRuntime | null>(null);
  const [draft, setDraft] = React.useState(SAMPLE_TEXT);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [busyTask, setBusyTask] = React.useState<string | null>(null);
  const [timelineTaskId, setTimelineTaskId] = React.useState<string | null>(null);
  const [timelineItems, setTimelineItems] = React.useState<RunnerTimelineItem[]>([]);
  const [actionMessage, setActionMessage] = React.useState("");

  const loadPipeline = React.useCallback(async () => {
    setLoading(true);
    try {
      const [intakeResponse, taskResponse, runtimeResponse] = await Promise.all([
        fetch("/api/runner/intakes", { cache: "no-store" }),
        fetch("/api/runner/tasks", { cache: "no-store" }),
        fetch("/api/runner/runtime", { cache: "no-store" }),
      ]);
      const intakePayload = await intakeResponse.json().catch(() => ({}));
      const taskPayload = await taskResponse.json().catch(() => ({}));
      const runtimePayload = await runtimeResponse.json().catch(() => ({}));
      setState({
        intakes: Array.isArray(intakePayload.intakes) ? intakePayload.intakes : [],
        tasks: Array.isArray(taskPayload.tasks) ? taskPayload.tasks : [],
        error: intakePayload.error ?? taskPayload.error ?? "",
      });
      setRuntime(runtimeResponse.ok ? runtimePayload as AiRuntime : null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPipeline();
  }, [loadPipeline]);

  async function submitIntake() {
    const text = draft.trim();
    if (!text) return;

    setSubmitting(true);
    setActionMessage("");
    try {
      const response = await fetch("/api/runner/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState((current) => ({ ...current, error: payload.error ?? "수집 실패" }));
        return;
      }
      setDraft("");
      setActionMessage("Runner에 원문을 저장하고 AI 분류를 요청했습니다.");
      window.setTimeout(() => void loadPipeline(), 1200);
    } finally {
      setSubmitting(false);
    }
  }

  async function runTaskAction(task: RunnerTask, action: "decide" | "execute") {
    if (!task.id) return;
    setBusyTask(`${task.id}:${action}`);
    setActionMessage("");
    try {
      const response = await fetch(`/api/runner/tasks/${encodeURIComponent(task.id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState((current) => ({ ...current, error: payload.error ?? "Runner 작업 처리 실패" }));
        return;
      }
      setActionMessage(action === "decide" ? "Decision Engine 판단을 반영했습니다." : "Runner 실행 요청을 보냈습니다.");
      await loadPipeline();
    } finally {
      setBusyTask(null);
    }
  }

  async function loadTimeline(task: RunnerTask) {
    if (!task.id) return;
    if (timelineTaskId === task.id) {
      setTimelineTaskId(null);
      setTimelineItems([]);
      return;
    }

    setBusyTask(`${task.id}:timeline`);
    try {
      const response = await fetch(`/api/runner/tasks/${encodeURIComponent(task.id)}/timeline`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState((current) => ({ ...current, error: payload.error ?? "Runner 이력 조회 실패" }));
        return;
      }
      setTimelineTaskId(task.id);
      setTimelineItems(Array.isArray(payload.items) ? payload.items : []);
    } finally {
      setBusyTask(null);
    }
  }

  return (
    <Card className="border-slate-200">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
              <DatabaseZap className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-slate-950">AI 수집 파이프라인</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                원문을 Runner intake에 저장하고, 업무 분류, 맥락 판단, 실행까지 이어서 확인합니다.
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadPipeline()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            새로고침
          </Button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Live AI Runtime</span>
                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-slate-300">
                  Prototype · Active development
                </span>
                <span className={runtime?.status === "live"
                  ? "rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300"
                  : "rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300"}>
                  {runtime?.status === "live" ? "LIVE" : runtime?.status === "configured" ? "READY · no live call yet" : "NOT CONFIGURED"}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                실제 Runner 호출 성공 기록만 표시합니다. 제품 전체 완성을 의미하지 않습니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
              <div><span className="text-slate-500">Provider</span><p className="mt-1 font-medium text-slate-100">{runtime?.provider === "nebius" ? "Nebius" : runtime?.provider ?? "—"}</p></div>
              <div><span className="text-slate-500">Model</span><p className="mt-1 max-w-[180px] truncate font-medium text-slate-100" title={runtime?.model ?? ""}>{runtime?.model ?? "—"}</p></div>
              <div><span className="text-slate-500">Latency</span><p className="mt-1 font-medium text-slate-100">{runtime?.latencyMs != null ? `${runtime.latencyMs} ms` : "—"}</p></div>
              <div><span className="text-slate-500">Last success</span><p className="mt-1 font-medium text-slate-100">{runtime?.lastSuccessAt ? formatDate(runtime.lastSuccessAt) : "—"}</p></div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-[104px] bg-white"
              placeholder="메일, 문자, 사이트 주문 화면에서 들어온 원문을 붙여 넣으세요."
            />
            <div className="flex justify-end">
              <Button type="button" onClick={submitIntake} disabled={submitting || !draft.trim()}>
                <SendHorizonal className="h-4 w-4" />
                수집 후 AI 분류
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-500">수집 원문</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{state.intakes.length}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-500">AI task</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{state.tasks.length}</p>
            </div>
          </div>
        </div>

        {actionMessage ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{actionMessage}</div>
        ) : null}
        {state.error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{state.error}</div> : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-950">최근 수집</p>
            {state.intakes.slice(0, 3).map((intake) => (
              <div key={intake.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge>{intake.source_type ?? "intake"}</Badge>
                  <span className="text-xs text-slate-400">{formatDate(intake.received_at ?? intake.created_at)}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-700">{intake.raw_text ?? "(원문 없음)"}</p>
              </div>
            ))}
            {!state.intakes.length ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">아직 수집된 원문이 없습니다.</p> : null}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-950">AI 분류 결과</p>
            {state.tasks.slice(0, 5).map((task) => {
              const decision = getTaskDecision(task);
              return (
                <div key={task.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="info">{task.task_type ?? "unknown"}</Badge>
                    <Badge variant={task.risk_level === "high" ? "warning" : "default"}>{task.risk_level ?? "risk"}</Badge>
                    <Badge>{task.status ?? "status"}</Badge>
                    {task.context_status ? <Badge variant="default">{task.context_status}</Badge> : null}
                    <span className="text-xs text-slate-400">
                      {typeof task.confidence === "number" ? `${Math.round(task.confidence * 100)}%` : ""}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{getTaskTitle(task)}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{getTaskSummary(task)}</p>
                  {task.due_at ? <p className="mt-1 text-xs text-slate-500">마감: {formatDate(task.due_at)}</p> : null}
                  {decision ? (
                    <div className="mt-2 rounded-2xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                      <p className="font-semibold text-slate-900">판단: {String(decision.outcome ?? "")}</p>
                      <p>{String(decision.reason ?? "")}</p>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void runTaskAction(task, "decide")}
                      disabled={!task.id || busyTask === `${task.id}:decide`}
                    >
                      <GitBranch className="h-4 w-4" />
                      판단
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void runTaskAction(task, "execute")}
                      disabled={!task.id || busyTask === `${task.id}:execute`}
                    >
                      <Play className="h-4 w-4" />
                      실행
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void loadTimeline(task)}
                      disabled={!task.id || busyTask === `${task.id}:timeline`}
                    >
                      <History className="h-4 w-4" />
                      이력
                    </Button>
                  </div>
                  {timelineTaskId === task.id ? (
                    <div className="mt-3 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      {timelineItems.length ? timelineItems.slice(0, 8).map((item) => (
                        <div key={item.id ?? `${item.type}-${item.at}`} className="rounded-xl bg-white p-2 text-xs text-slate-600">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900">{item.title ?? item.type}</span>
                            <span className="text-slate-400">{formatDate(item.at)}</span>
                          </div>
                          <p className="mt-1">{item.source} · {item.type}</p>
                        </div>
                      )) : <p className="text-sm text-slate-500">표시할 이력이 없습니다.</p>}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!state.tasks.length ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">아직 AI가 만든 task가 없습니다.</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
