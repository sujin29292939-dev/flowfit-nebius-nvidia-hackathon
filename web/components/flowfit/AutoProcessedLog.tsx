"use client";

import { BarChart3, CheckCircle2, Plus, RotateCcw, ShieldCheck, X } from "lucide-react";
import * as React from "react";

import { FlowFitRoleControl, RestrictedEmployeeView, canUseAiOperations, useFlowFitRole } from "@/components/flowfit/flowfit-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils";
import type { AutoProcessingCriterion } from "@/services/autoProcessingCriteriaStore";
import { getAutoProcessedRecords } from "@/services/aiWorkStore";
import type { AutoProcessedRecord } from "@/types/flowfit";

type MonthlyAutoStat = {
  key: string;
  label: string;
  count: number;
};

function buildMonthlyStats(records: AutoProcessedRecord[]) {
  const now = new Date();

  return Array.from({ length: 12 }, (_, index): MonthlyAutoStat => {
    const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const count = records.filter((record) => {
      const processedAt = new Date(record.processedAt);
      return processedAt.getFullYear() === date.getFullYear() && processedAt.getMonth() === date.getMonth();
    }).length;

    return {
      key,
      label: `${date.getMonth() + 1}월`,
      count,
    };
  });
}

type CriteriaResponse = {
  criteria?: AutoProcessingCriterion[];
  error?: string;
};

const criteriaToneClass: Record<AutoProcessingCriterion["tone"], string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
  sky: "border-sky-200 bg-sky-50 text-sky-950",
  amber: "border-amber-200 bg-amber-50 text-amber-950",
  rose: "border-rose-200 bg-rose-50 text-rose-950",
  violet: "border-violet-200 bg-violet-50 text-violet-950",
};

const keywordToneClass: Record<AutoProcessingCriterion["tone"], string> = {
  emerald: "border-emerald-200 bg-white text-emerald-800",
  sky: "border-sky-200 bg-white text-sky-800",
  amber: "border-amber-200 bg-white text-amber-800",
  rose: "border-rose-200 bg-white text-rose-800",
  violet: "border-violet-200 bg-white text-violet-800",
};

export function AutoProcessedLog() {
  const { role, setRole } = useFlowFitRole();
  const [records, setRecords] = React.useState<AutoProcessedRecord[]>([]);
  const [criteria, setCriteria] = React.useState<AutoProcessingCriterion[]>([]);
  const [keywordDrafts, setKeywordDrafts] = React.useState<Record<string, string>>({});
  const [criteriaError, setCriteriaError] = React.useState("");

  React.useEffect(() => {
    setRecords(getAutoProcessedRecords());
  }, []);

  const loadCriteria = React.useCallback(async () => {
    try {
      setCriteriaError("");
      const response = await fetch("/api/auto-processing-criteria", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as CriteriaResponse;

      if (!response.ok || !Array.isArray(body.criteria)) {
        throw new Error(body.error ?? `자동 처리 기준 조회 실패: ${response.status}`);
      }

      setCriteria(body.criteria);
    } catch (error) {
      setCriteriaError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  React.useEffect(() => {
    void loadCriteria();
  }, [loadCriteria]);

  const addKeyword = React.useCallback(async (criterionId: string) => {
    const keyword = keywordDrafts[criterionId]?.trim();
    if (!keyword) return;

    try {
      setCriteriaError("");
      const response = await fetch("/api/auto-processing-criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criterionId, keyword }),
      });
      const body = (await response.json().catch(() => ({}))) as CriteriaResponse;

      if (!response.ok || !Array.isArray(body.criteria)) {
        throw new Error(body.error ?? `키워드 추가 실패: ${response.status}`);
      }

      setCriteria(body.criteria);
      setKeywordDrafts((current) => ({ ...current, [criterionId]: "" }));
    } catch (error) {
      setCriteriaError(error instanceof Error ? error.message : String(error));
    }
  }, [keywordDrafts]);

  const deleteKeyword = React.useCallback(async (criterionId: string, keywordId: string) => {
    try {
      setCriteriaError("");
      const response = await fetch("/api/auto-processing-criteria", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criterionId, keywordId }),
      });
      const body = (await response.json().catch(() => ({}))) as CriteriaResponse;

      if (!response.ok || !Array.isArray(body.criteria)) {
        throw new Error(body.error ?? `키워드 삭제 실패: ${response.status}`);
      }

      setCriteria(body.criteria);
    } catch (error) {
      setCriteriaError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  if (!canUseAiOperations(role)) {
    return (
      <div className="space-y-4">
        <FlowFitRoleControl role={role} onChange={setRole} />
        <RestrictedEmployeeView />
      </div>
    );
  }

  const monthlyStats = buildMonthlyStats(records);
  const maxMonthlyCount = Math.max(1, ...monthlyStats.map((stat) => stat.count));
  const totalAutoProcessed = records.length;
  const reversibleCount = records.filter((record) => record.reversible).length;
  const latestRecord = [...records].sort((a, b) => b.processedAt.localeCompare(a.processedAt))[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-950">AI가 자동으로 처리한 업무</h1>
        </div>
        <FlowFitRoleControl role={role} onChange={setRole} />
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold text-white">
              <BarChart3 className="h-3.5 w-3.5" />
              최근 1년
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-slate-950">월별 자동 처리 흐름</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              FlowFit이 내부 분류, 기록 저장, 반복 알림처럼 낮은 위험도 업무를 얼마나 자동으로 처리했는지 월별로 보여줍니다.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-sm sm:min-w-[24rem]">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold text-emerald-700">누적 자동 처리</p>
              <p className="mt-2 text-3xl font-semibold text-emerald-950">{totalAutoProcessed}</p>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
              <p className="text-xs font-semibold text-sky-700">되돌리기 가능</p>
              <p className="mt-2 text-3xl font-semibold text-sky-950">{reversibleCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">최근 처리</p>
              <p className="mt-2 text-sm font-semibold leading-5 text-slate-950">{latestRecord ? formatDateTime(latestRecord.processedAt) : "기록 없음"}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex h-72 items-end gap-2 rounded-3xl bg-slate-50 p-4">
          {monthlyStats.map((stat) => {
            const height = stat.count === 0 ? 8 : Math.max(18, (stat.count / maxMonthlyCount) * 210);
            return (
              <div key={stat.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <div className="text-xs font-semibold text-slate-500">{stat.count}</div>
                <div
                  className="w-full max-w-10 rounded-t-2xl bg-slate-950 transition-all"
                  style={{ height }}
                  aria-label={`${stat.label} 자동 처리 ${stat.count}건`}
                />
                <div className="text-[11px] font-semibold text-slate-400">{stat.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      <div>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-950">자동 처리 기준</p>
                <p className="mt-1 text-xs font-semibold text-slate-400">.flowfit/auto-processing-criteria-keywords.json 연결</p>
              </div>
            </div>

            {criteriaError ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{criteriaError}</div>
            ) : null}

            <div className="mt-4 grid gap-3">
              {criteria.map((criterion) => (
                <div key={criterion.id} className={`rounded-2xl border p-3 ${criteriaToneClass[criterion.tone]}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{criterion.title}</p>
                        <Badge variant={criterion.autoAllowed ? "success" : "warning"}>{criterion.autoAllowed ? "자동 처리" : "승인함"}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 opacity-75">{criterion.description}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {criterion.keywords.map((keyword) => (
                      <span key={keyword.id} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${keywordToneClass[criterion.tone]}`}>
                        {keyword.label}
                        {keyword.source === "user" ? (
                          <button
                            type="button"
                            className="rounded-full p-0.5 text-current opacity-60 transition hover:bg-slate-100 hover:opacity-100"
                            aria-label={`${keyword.label} 키워드 삭제`}
                            title={`${keyword.label} 키워드 삭제`}
                            onClick={() => void deleteKeyword(criterion.id, keyword.id)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>

                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void addKeyword(criterion.id);
                    }}
                  >
                    <Input
                      value={keywordDrafts[criterion.id] ?? ""}
                      onChange={(event) => setKeywordDrafts((current) => ({ ...current, [criterion.id]: event.target.value }))}
                      placeholder="키워드 추가"
                      className="h-9 rounded-lg bg-white text-xs"
                      maxLength={32}
                    />
                    <Button type="submit" size="sm" disabled={!keywordDrafts[criterion.id]?.trim()}>
                      <Plus className="h-4 w-4" />
                      추가
                    </Button>
                  </form>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {records.map((record) => (
          <article key={record.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="success">자동 처리됨</Badge>
                  <Badge>{record.source}</Badge>
                </div>
                <h2 className="mt-3 text-xl font-semibold text-slate-950">{record.title}</h2>
                <p className="mt-2 text-sm text-slate-500">처리 시간: {formatDateTime(record.processedAt)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm lg:w-[21rem]">
                <p className="text-xs font-semibold text-slate-400">되돌리기 가능 여부</p>
                <p className="mt-1 font-semibold text-slate-900">{record.reversible ? "가능" : "불가"}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-400">처리 결과</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{record.result}</p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-semibold text-emerald-700">자동 처리 이유</p>
                <p className="mt-2 text-sm leading-6 text-emerald-950">{record.reason}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm">
                <CheckCircle2 className="h-4 w-4" />
                상세 보기
              </Button>
              {record.reversible ? (
                <Button type="button" variant="outline" size="sm">
                  <RotateCcw className="h-4 w-4" />
                  되돌리기 검토
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
