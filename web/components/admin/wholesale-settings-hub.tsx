import {
  Activity,
  ArrowRight,
  CreditCard,
  PackageCheck,
  RotateCcw,
  Tags,
  type LucideIcon,
} from "lucide-react";

import type { WholesaleSettings } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";
import { formatWonMan } from "@/lib/wholesale-engine";

type ModuleKey = "dunning" | "delivery" | "accountHealth" | "pricing" | "claims";

type ModuleCard = {
  route: string;
  key: ModuleKey;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: string;
};

const moduleCards: readonly ModuleCard[] = [
  {
    route: "/admin/settings/dunning",
    key: "dunning",
    title: "미수금 설정",
    description: "P1 금액 기준, P1 연체 일수, 재알림 주기를 조정합니다.",
    icon: CreditCard,
    accent: "bg-rose-500",
  },
  {
    route: "/admin/settings/delivery",
    key: "delivery",
    title: "납기 설정",
    description: "납기 전 선제 알림일, 지연 판정일, 담당자 재호출 기준을 조정합니다.",
    icon: PackageCheck,
    accent: "bg-sky-500",
  },
  {
    route: "/admin/settings/account-health",
    key: "accountHealth",
    title: "거래처의 건강판단 설정",
    description: "거래처 R/F/M, 주의 점수, 발주량 감소 기준을 조정합니다.",
    icon: Activity,
    accent: "bg-emerald-500",
  },
  {
    route: "/admin/settings/pricing",
    key: "pricing",
    title: "단가표 설정",
    description: "주의 변동률, 심각 변동률, 에이전트가 읽을 파일 형식을 조정합니다.",
    icon: Tags,
    accent: "bg-violet-500",
  },
  {
    route: "/admin/settings/claims",
    key: "claims",
    title: "반품·클레임 설정",
    description: "클레임 분류 항목, 기본 배정 방식, 누적 경고 기준을 조정합니다.",
    icon: RotateCcw,
    accent: "bg-amber-500",
  },
] as const;

const assignmentModeLabels = {
  "partner-owner": "거래처 담당 우선",
  "round-robin": "순번 배정",
  manual: "수동 배정",
} as const;

function describeModule(key: ModuleKey, settings: WholesaleSettings) {
  switch (key) {
    case "dunning":
      return [
        { label: "P1 금액 기준", value: formatWonMan(settings.dunning.p1AmountThreshold) },
        { label: "P1 연체 일수", value: `${formatNumber(settings.dunning.p1OverdueDays)}일` },
        { label: "재알림 주기", value: `${formatNumber(settings.dunning.followUpCadenceDays)}일` },
      ];
    case "delivery":
      return [
        {
          label: "납기 전 알림",
          value: [settings.delivery.enableD3Alerts ? "D-3" : null, settings.delivery.enableD1Alerts ? "D-1" : null]
            .filter(Boolean)
            .join("/") || "꺼짐",
        },
        { label: "지연 판정일", value: `${formatNumber(settings.delivery.delayThresholdDays)}일` },
        { label: "담당자 재호출", value: `${formatNumber(settings.delivery.managerEscalationHours)}시간` },
      ];
    case "accountHealth":
      return [
        {
          label: "거래처 R/F/M",
          value: `${formatNumber(settings.accountHealth.recencyWeight)}/${formatNumber(settings.accountHealth.frequencyWeight)}/${formatNumber(settings.accountHealth.monetaryWeight)}`,
        },
        { label: "주의 점수", value: formatNumber(settings.accountHealth.warningScoreCutoff) },
        { label: "발주 감소", value: `${formatNumber(settings.accountHealth.orderDropThresholdPercent)}%` },
      ];
    case "pricing":
      return [
        { label: "주의 변동률", value: `${formatNumber(settings.pricing.warningChangeRatePercent)}%` },
        { label: "심각 변동률", value: `${formatNumber(settings.pricing.criticalChangeRatePercent)}%` },
        { label: "허용 파일", value: settings.pricing.allowedFileTypes.join("/") },
      ];
    case "claims":
      return [
        { label: "분류 항목", value: `${formatNumber(settings.claims.enabledCategories.length)}종` },
        { label: "배정 방식", value: assignmentModeLabels[settings.claims.autoAssignMode] },
        { label: "누적 경고", value: `${formatNumber(settings.claims.accumulatedCountThreshold)}건` },
      ];
  }
}

export function WholesaleSettingsHub({ settings }: { settings: WholesaleSettings }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
        <h2 className="text-xl font-semibold text-slate-950 sm:text-2xl">에이전트 판단 기준 설정</h2>
      </div>

      <div id="settings-modules" className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-5">
        {moduleCards.map((card) => {
          const Icon = card.icon;
          const summary = describeModule(card.key, settings);

          return (
            <a key={card.route} href={card.route} className="group block min-w-0">
              <article className="relative flex h-full min-h-[8.75rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-2.5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-panel sm:p-3">
                <span className={cn("absolute inset-x-0 top-0 h-1", card.accent)} />
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white sm:h-9 sm:w-9">
                    <Icon className="h-4 w-4" />
                  </div>
                </div>

                <h2 className="mt-3 text-[13px] font-semibold leading-5 text-slate-950 sm:text-sm">{card.title}</h2>
                <p className="mt-1 hidden max-h-10 overflow-hidden text-xs leading-5 text-slate-500 md:block">{card.description}</p>

                <div className="mt-auto hidden grid-cols-3 gap-1 pt-2 2xl:grid">
                  {summary.map((item) => (
                    <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                      <p className="truncate text-[10px] font-semibold text-slate-400">{item.label}</p>
                      <p className="mt-0.5 truncate text-xs font-semibold text-slate-900">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-xs font-semibold text-slate-950">
                  <span className="truncate">설정 변경</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 transition group-hover:translate-x-0.5" />
                </div>
              </article>
            </a>
          );
        })}
      </div>
    </section>
  );
}
