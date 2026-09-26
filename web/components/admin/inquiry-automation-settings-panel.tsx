"use client";

import {
  ArrowRight,
  Bot,
  Link2,
  Settings2,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

import type {
  AdminSettings,
  BrowserAutomationOverview,
  MobileAppDownloadInfo,
  MobileDetectorOverview,
  MobilePairingCodeRecord,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type SettingsSectionKey = "integration" | "status" | "automation" | "browser";

type SettingsSection = {
  key: SettingsSectionKey;
  route: string;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
  summary: Array<{ label: string; value: string }>;
  tone: string;
};

export function InquiryAutomationSettingsPanel({
  settings,
  mobileDetectorOverview,
  pairingCodes,
  mobileAppDownload,
  browserAutomationOverview,
}: {
  settings: AdminSettings;
  mobileDetectorOverview: MobileDetectorOverview;
  pairingCodes: MobilePairingCodeRecord[];
  mobileAppDownload: MobileAppDownloadInfo;
  browserAutomationOverview: BrowserAutomationOverview;
}) {
  const activePairingCodes = pairingCodes.filter((code) => code.active && !code.expired && !code.exhausted).length;
  const activeDevices = mobileDetectorOverview.summary?.active_devices_30m ?? mobileDetectorOverview.devices.filter((device) => !device.stale_30m).length;
  const enabledRules = settings.notificationRules.filter((rule) => rule.enabled).length;
  const onlineBrowserSessions = browserAutomationOverview.sessions.filter((session) => session.status === "online").length;
  const settingsSections: SettingsSection[] = [
    {
      key: "integration",
      route: "/admin/settings/mobile-app",
      label: "모바일 연동",
      title: "현장 접수 앱 연결",
      description: mobileAppDownload.available ? "접수 앱과 QR 연결 코드를 준비했습니다." : "외부에서의 파일을 수집하는 것을 설정합니다.",
      icon: Link2,
      summary: [
        { label: "활성 코드", value: `${activePairingCodes}개` },
        { label: "앱 파일", value: mobileAppDownload.available ? "준비됨" : "확인 필요" },
        { label: "버전", value: mobileAppDownload.versionName },
      ],
      tone: "bg-sky-500",
    },
    {
      key: "status",
      route: "/admin/settings/mobile-detector",
      label: "수집기 상태",
      title: "모바일 감지기 상태",
      description: mobileDetectorOverview.connected ? "현장 업로드 수집기가 연결되어 있습니다." : "모바일 수집기 연결을 확인해야 합니다.",
      icon: Smartphone,
      summary: [
        { label: "활성 기기", value: `${activeDevices}대` },
        { label: "전체 기기", value: `${mobileDetectorOverview.devices.length}대` },
        { label: "연결", value: mobileDetectorOverview.connected ? "정상" : "확인" },
      ],
      tone: "bg-emerald-500",
    },
    {
      key: "automation",
      route: "/admin/settings/inquiry-automation",
      label: "자동화 기준",
      title: "문의 접수 자동화 기준",
      description: "문제 표시 기준과 기본 알림 규칙을 관리합니다.",
      icon: Settings2,
      summary: [
        { label: "활성 규칙", value: `${enabledRules}개` },
        { label: "주의 기준", value: `${settings.badgeRules.warningThreshold}` },
        { label: "위험 기준", value: `${settings.badgeRules.criticalThreshold}` },
      ],
      tone: "bg-violet-500",
    },
    {
      key: "browser",
      route: "/admin/settings/browser-automation",
      label: "브라우저 브릿지",
      title: "브라우저 자동화 연결",
      description: browserAutomationOverview.connected ? "승인된 브라우저 조작만 실행하도록 제한합니다." : "자동화할 브라우저를 설정합니다.",
      icon: Bot,
      summary: [
        { label: "온라인", value: `${onlineBrowserSessions}개` },
        { label: "정책", value: `v${browserAutomationOverview.policyVersion}` },
        { label: "연결", value: browserAutomationOverview.connected ? "정상" : "확인" },
      ],
      tone: "bg-indigo-500",
    },
  ];

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
        <h2 className="text-xl font-semibold text-slate-950 sm:text-2xl">연동과 자동화 설정</h2>
      </div>

      <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-4">
        {settingsSections.map((section) => {
          const Icon = section.icon;

          return (
            <a key={section.key} href={section.route} className="group block min-w-0">
              <article className="relative flex h-full min-h-[8.75rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-2.5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-panel sm:p-3">
                <span className={cn("absolute inset-x-0 top-0 h-1", section.tone)} />
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white sm:h-9 sm:w-9">
                    <Icon className="h-4 w-4" />
                  </div>
                </div>

                <h2 className="mt-3 text-[13px] font-semibold leading-5 text-slate-950 sm:text-sm">{section.title}</h2>
                <p className="mt-1 hidden max-h-10 overflow-hidden text-xs leading-5 text-slate-500 md:block">{section.description}</p>

                <div className="mt-auto hidden grid-cols-3 gap-1 pt-2 2xl:grid">
                  {section.summary.map((item) => (
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
