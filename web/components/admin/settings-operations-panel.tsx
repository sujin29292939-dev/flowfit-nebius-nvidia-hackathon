"use client";

import * as React from "react";
import {
  ClipboardCheck,
  History,
  Inbox,
  Ticket,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type OperationLink = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

const operationLinks: OperationLink[] = [
  {
    href: "/workspace",
    label: "AI 운영 요청실",
    description: "대표와 관리자가 AI에게 반복 온라인 업무를 요청하는 화면입니다.",
    icon: Ticket,
  },
  {
    href: "/admin/agent-runs",
    label: "AI 작업 승인함",
    description: "AI가 만든 결과물을 승인, 수정, 반려하거나 직원 확인 요청으로 넘깁니다.",
    icon: ClipboardCheck,
  },
  {
    href: "/admin/exceptions",
    label: "예외 접수함",
    description: "현장 사진, 메모, 영수증, 발주서 후보를 공식 회사 정보로 승격합니다.",
    icon: Inbox,
  },
  {
    href: "/admin/staff-confirmations",
    label: "직원 확인 요청",
    description: "외부 채널로 보낸 직원 확인 요청과 응답을 관리합니다.",
    icon: UserRoundCheck,
  },
  {
    href: "/admin/auto-logs",
    label: "자동 처리 기록",
    description: "승인 없이 처리된 낮은 위험도 작업 기록을 확인합니다.",
    icon: History,
  },
];

export function SettingsOperationsPanel() {
  const [selectedHref, setSelectedHref] = React.useState(operationLinks[0]?.href ?? "");
  const selected = operationLinks.find((item) => item.href === selectedHref) ?? operationLinks[0];
  const SelectedIcon = selected.icon;

  return (
    <Card className="border-slate-200 bg-white/90 shadow-none">
      <CardContent className="p-0">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-xl font-semibold text-slate-950">운영 화면 미리보기</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            FlowFit의 핵심 화면을 설정 안에서 바로 열어 현재 흐름을 점검합니다.
          </p>
        </div>

        <div className="grid min-h-[320px] gap-0 lg:grid-cols-[320px_1fr]">
          <div className="border-b border-slate-200 p-3 lg:border-b-0 lg:border-r">
            <div className="space-y-2">
              {operationLinks.map((item) => {
                const Icon = item.icon;
                const active = item.href === selected.href;

                return (
                  <button
                    key={item.href}
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-3 rounded-2xl border px-4 py-4 text-left transition",
                      active
                        ? "border-slate-950 bg-slate-950 text-white shadow-panel"
                        : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
                    )}
                    onClick={() => setSelectedHref(item.href)}
                  >
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                        active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-800"
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{item.label}</p>
                      <p className={cn("mt-1 text-sm leading-6", active ? "text-slate-200" : "text-slate-500")}>
                        {item.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">선택 화면</p>
              <div className="mt-3 flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-800 shadow-sm">
                  <SelectedIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-2xl font-semibold text-slate-950">{selected.label}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-500">{selected.description}</p>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <iframe
                  key={selected.href}
                  title={`${selected.label} 미리보기`}
                  src={selected.href}
                  className="h-[780px] w-full bg-white"
                />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
