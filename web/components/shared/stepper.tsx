import { Check } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { OnboardingStage, StageStep } from "@/lib/types";

const stageOrder: OnboardingStage[] = [
  "basic-info",
  "privacy-consent",
  "kakao-connected",
  "test-run",
  "active",
];

export function Stepper({
  steps,
  currentStage,
  progress,
}: {
  steps: StageStep[];
  currentStage: OnboardingStage;
  progress: number;
}) {
  const currentIndex = stageOrder.indexOf(currentStage);

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-white p-6 shadow-panel">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">온보딩 진행 단계</p>
          <p className="mt-1 text-sm text-slate-500">현재 어떤 단계에서 멈췄는지와 다음 액션을 함께 보여줍니다.</p>
        </div>
        <div className="w-44">
          <Progress value={progress} />
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        {steps.map((step, index) => {
          const state =
            index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";

          return (
            <div
              key={step.key}
              className={cn(
                "rounded-2xl border p-4",
                state === "complete" && "border-emerald-200 bg-emerald-50",
                state === "current" && "border-sky-200 bg-sky-50",
                state === "upcoming" && "border-border bg-slate-50",
              )}
            >
              <div className="mb-3 flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold",
                    state === "complete" && "border-emerald-400 bg-emerald-600 text-white",
                    state === "current" && "border-sky-300 bg-sky-600 text-white",
                    state === "upcoming" && "border-slate-300 bg-white text-slate-500",
                  )}
                >
                  {state === "complete" ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <p className="text-sm font-semibold text-slate-900">{step.label}</p>
              </div>
              <p className="text-sm leading-6 text-slate-600">{step.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
