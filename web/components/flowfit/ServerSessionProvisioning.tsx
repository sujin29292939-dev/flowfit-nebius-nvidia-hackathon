"use client";

import { Check, Loader2, X } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { RunnerProvisionResponse, RunnerProvisionStep } from "@/services/runnerClient";

type Props = {
  result: RunnerProvisionResponse | null;
  error?: string;
  loading?: boolean;
};

const STEP_ORDER: RunnerProvisionStep["id"][] = [
  "token_validate",
  "tenant_provision",
  "plan_apply",
  "device_pair",
  "policy_sync",
  "ready",
];

export function ServerSessionProvisioning({ result, error, loading }: Props) {
  const steps = result?.steps ?? STEP_ORDER.map((id) => ({
    id,
    label: fallbackLabel(id),
    status: id === "token_validate" ? "running" : "pending",
    message: id === "token_validate" ? "서버 확인 중" : "대기 중",
  } satisfies RunnerProvisionStep));

  const doneCount = steps.filter((step) => step.status === "done").length;
  const failed = steps.some((step) => step.status === "failed") || Boolean(error);
  const progress = failed ? Math.max(12, (doneCount / steps.length) * 100) : (doneCount / steps.length) * 100;

  return (
    <div className="w-full max-w-lg rounded-3xl border border-white/15 bg-white p-6 text-left shadow-2xl">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">서버 세션 구축</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">FlowFit 실행 환경 준비</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          회사 토큰 확인, 정책 적용, 기기 연결 코드를 순서대로 준비합니다.
        </p>
      </div>

      <Progress value={progress} className={failed ? "[&>div]:bg-rose-500" : undefined} />

      <div className="mt-5 space-y-3">
        {steps.map((step) => (
          <div
            key={step.id}
            className={cn(
              "flex gap-3 rounded-2xl border p-3",
              step.status === "done" && "border-emerald-200 bg-emerald-50",
              step.status === "running" && "border-sky-200 bg-sky-50",
              step.status === "failed" && "border-rose-200 bg-rose-50",
              step.status === "pending" && "border-slate-200 bg-slate-50",
            )}
          >
            <div className="mt-0.5">
              {step.status === "done" ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Check className="h-3.5 w-3.5" />
                </span>
              ) : step.status === "failed" ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-white">
                  <X className="h-3.5 w-3.5" />
                </span>
              ) : step.status === "running" ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-white">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                </span>
              ) : (
                <span className="block h-6 w-6 rounded-full border border-slate-300 bg-white" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-950">{step.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{step.message}</p>
            </div>
          </div>
        ))}
      </div>

      {result?.pairingCode ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500">기기 페어링 코드</p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-950">{result.pairingCode}</p>
          <p className="mt-1 text-xs text-slate-500">실행 에이전트 연결에 사용할 수 있습니다.</p>
        </div>
      ) : null}

      {error ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}

function fallbackLabel(id: RunnerProvisionStep["id"]) {
  switch (id) {
    case "token_validate": return "발급 토큰 확인";
    case "tenant_provision": return "회사 작업 공간 준비";
    case "plan_apply": return "플랜 정책 적용";
    case "device_pair": return "기기 연결 코드 발급";
    case "policy_sync": return "로컬 안전 정책 동기화";
    case "ready": return "로그인 준비 완료";
  }
}
