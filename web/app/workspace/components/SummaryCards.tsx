"use client";

import { Brain, CheckCircle2, Clock3, ClipboardCheck, Lightbulb } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/utils";
import { getAutoProcessedRecords } from "@/services/aiWorkStore";
import type { AutoProcessedRecord } from "@/types/flowfit";

type SummaryData = {
  autoProcessedToday: number;
  pendingApproval: number;
  inProgress: number;
  lastUpdated: string;
};

const fallbackSummary: SummaryData = {
  autoProcessedToday: 0,
  pendingApproval: 0,
  inProgress: 0,
  lastUpdated: new Date().toISOString(),
};

function buildLearnedTips(records: AutoProcessedRecord[]) {
  const hasCustomerSource = records.some((record) => record.source.includes("고객") || record.result.includes("문의"));
  const hasReversibleWork = records.some((record) => record.reversible);

  return [
    hasCustomerSource
      ? "고객 문의는 배송, 주문 변경, 일반 문의로 먼저 나누면 승인함에 올라갈 작업을 더 빨리 줄일 수 있습니다."
      : "반복 입력은 유형별로 먼저 분류하면 낮은 위험도 작업을 자동 처리 후보로 분리하기 쉽습니다.",
    hasReversibleWork
      ? "되돌리기 가능한 내부 분류 작업은 자동 처리에 적합합니다. 고객 발송 문구는 승인 단계에 남기는 편이 안전합니다."
      : "되돌리기 어려운 작업은 자동 처리보다 승인 대기 카드로 보내는 것이 안전합니다.",
    "자동 처리 결과를 매주 확인하면 자주 반복되는 업무를 자동화 규칙으로 승격할 수 있습니다.",
  ];
}

export default function SummaryCards() {
  const [data, setData] = React.useState<SummaryData>(fallbackSummary);
  const [tips, setTips] = React.useState<string[]>(() => buildLearnedTips([]));

  const fetchSummary = React.useCallback(async () => {
    const response = await fetch("/api/summary", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as Partial<SummaryData>;
    setData({
      autoProcessedToday: Number(payload.autoProcessedToday ?? 0),
      pendingApproval: Number(payload.pendingApproval ?? 0),
      inProgress: Number(payload.inProgress ?? 0),
      lastUpdated: payload.lastUpdated ?? new Date().toISOString(),
    });
  }, []);

  React.useEffect(() => {
    void fetchSummary();
    const intervalId = window.setInterval(fetchSummary, 30_000);
    return () => window.clearInterval(intervalId);
  }, [fetchSummary]);

  React.useEffect(() => {
    setTips(buildLearnedTips(getAutoProcessedRecords()));
  }, []);

  return (
    <section className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-950">오늘 운영 현황</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <SummaryCard icon={CheckCircle2} label="오늘 자동 처리" value={data.autoProcessedToday} tone="emerald" href="/admin/auto-logs" />
          <SummaryCard
            icon={ClipboardCheck}
            label="승인 필요"
            value={data.pendingApproval}
            tone={data.pendingApproval > 0 ? "rose" : "slate"}
            href="/admin/agent-runs"
          />
          <SummaryCard icon={Clock3} label="진행 중" value={data.inProgress} tone="sky" href="/workspace?view=ai-running" />
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
            <Lightbulb className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-950">AI가 기록에서 만든 팁</p>
            <p className="mt-1 text-xs text-slate-500">자동 처리 기록을 바탕으로 제안합니다.</p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {tips.slice(0, 3).map((tip) => (
            <div key={tip} className="flex gap-2 rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              <Brain className="mt-1 h-4 w-4 shrink-0 text-slate-500" />
              <p>{tip}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone: "emerald" | "rose" | "sky" | "slate";
  href: string;
}) {
  const toneClass = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
  }[tone];

  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-[5.25rem] items-center justify-between rounded-2xl border p-3 transition hover:-translate-y-0.5 hover:shadow-md",
        toneClass,
      )}
    >
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-normal">{value}</p>
      </div>
      <Icon className="h-5 w-5" />
    </Link>
  );
}
