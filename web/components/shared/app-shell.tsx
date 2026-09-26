"use client";

import { Bell, ChevronDown, Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import type { ReactNode } from "react";

import { FlowFitLogoMark } from "@/components/flowfit/FlowFitLogoMark";
import { ConversationSidebar, ConversationSidebarDrawer } from "@/components/flowfit/chat/ConversationSidebar";
import { Button } from "@/components/ui/button";
import { useFlowFitChatI18n } from "@/hooks/useFlowFitChatI18n";
import { useFlowFitConversations } from "@/hooks/useFlowFitConversations";
import { adminNavigation, type NavigationItem } from "@/lib/navigation";
import type { DataMode, UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";

type ShellNavigationItem = NavigationItem;

const PRIMARY_NAVIGATION_COUNT = 2;

const NOTIFICATION_SETTINGS_KEY = "flowfit-notification-settings";

type PriorityHelpDefinition = {
  label: string;
  description: string;
};

const notificationPreferenceItems = [
  {
    id: "approval",
    label: "승인 필요",
    description: "대표 확인이 필요한 AI 작업",
  },
  {
    id: "running",
    label: "AI 실행 상태",
    description: "처리 중, 대기 중, 실패한 실행 흐름",
  },
  {
    id: "auto",
    label: "자동 처리 완료",
    description: "승인 없이 처리된 낮은 위험도 업무",
  },
  {
    id: "staff",
    label: "직원 확인 응답",
    description: "외부 채널로 보낸 확인 요청의 응답",
  },
  {
    id: "risk",
    label: "주의 필요",
    description: "실패, 반려, 위험도 높은 작업",
  },
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getPriorityHelpDefinitions(pathname: string): PriorityHelpDefinition[] {
  if (isActivePath(pathname, "/admin/settings/dunning")) {
    return [
      {
        label: "P1",
        description: "사용자님이 1순위로 바로 확인해야 하는 단계입니다. 거래처의 연체 일수가 기준을 넘으면 사용자님의 확인 요청 카드로 옮깁니다.",
      },
      {
        label: "P2",
        description: "2순위로 확인하셔야 하는 주의 단계입니다. P1보다 낮지만 사용자님이 놓치지 않도록 알림을 보냅니다.",
      },
    ];
  }

  if (isActivePath(pathname, "/admin/settings/claims")) {
    return [
      {
        label: "P1",
        description: "사용자님이 1순위로 바로 확인해야 하는 클레임 단계입니다. 강하게 봐야 하는 키워드가 걸리면 확인 요청 카드로 옮깁니다.",
      },
      {
        label: "P2",
        description: "2순위로 확인하셔야 하는 주의 클레임 단계입니다. P1보다 낮지만 사용자님이 놓치지 않도록 알림을 보냅니다.",
      },
    ];
  }

  return [];
}

function ShellNavigationLink({
  item,
  active,
  compact = false,
  onClick,
}: {
  item: ShellNavigationItem;
  active: boolean;
  compact?: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl text-sm font-medium transition",
        compact ? "shrink-0 px-3 py-2" : "px-3 py-2.5",
        active
          ? "bg-slate-950 text-white hover:bg-slate-900 hover:text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>
  );
}

export function NotificationCenter() {
  const [open, setOpen] = React.useState(false);
  const [settings, setSettings] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(notificationPreferenceItems.map((item) => [item.id, true])),
  );

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(NOTIFICATION_SETTINGS_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, boolean>;
      setSettings((current) => ({ ...current, ...parsed }));
    } catch {
      // Ignore malformed local settings and keep defaults.
    }
  }, []);

  function toggleSetting(id: string) {
    setSettings((current) => {
      const next = { ...current, [id]: !current[id] };
      window.localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="icon" aria-label="알림 열기" onClick={() => setOpen(true)}>
        <Bell className="h-4 w-4" />
      </Button>
      {open ? (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/30 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true">
          <button type="button" aria-label="알림 닫기" className="absolute inset-0 cursor-default" onClick={() => setOpen(false)} />
          <div className="relative z-[101] w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">알림 설정</p>
                <p className="mt-1 text-xs text-slate-500">받고 싶은 운영 알림만 켜두세요.</p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="알림 닫기" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 space-y-2">
              {notificationPreferenceItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleSetting(item.id)}
                  className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:bg-white"
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-950">{item.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1 text-xs font-semibold",
                      settings[item.id] ? "bg-slate-950 text-white" : "bg-slate-200 text-slate-500",
                    )}
                  >
                    {settings[item.id] ? "받기" : "끄기"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function UserProfilePanel() {
  return (
    <div className="mt-auto rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <FlowFitLogoMark className="h-11 w-11 rounded-2xl border border-slate-200 p-1.5" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">FlowFit 대표</p>
          <p className="mt-0.5 text-xs text-slate-500">대표 계정</p>
        </div>
        <UserRound className="ml-auto h-4 w-4 text-slate-400" />
      </div>
    </div>
  );
}

export function AppShell({
  role: _role,
  dataMode: _dataMode,
  children,
}: {
  role: UserRole;
  dataMode?: DataMode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, t, toggleLocale } = useFlowFitChatI18n();
  const conversations = useFlowFitConversations();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [priorityHelpOpen, setPriorityHelpOpen] = React.useState(false);
  const primaryNavigation = adminNavigation.slice(0, PRIMARY_NAVIGATION_COUNT);
  const secondaryNavigation = adminNavigation.slice(PRIMARY_NAVIGATION_COUNT);
  const activeItem = adminNavigation.find((item) => isActivePath(pathname, item.href));
  const isSettings = isActivePath(pathname, "/admin/settings");
  const isSettingsHome = pathname === "/admin/settings";
  const isWorkspace = isActivePath(pathname, "/workspace");
  const isApprovalInbox = isActivePath(pathname, "/admin/agent-runs");
  const hideCommonHeader = isSettings || isWorkspace;
  const priorityHelpDefinitions = getPriorityHelpDefinitions(pathname);

  React.useEffect(() => {
    setMobileMenuOpen(false);
    setPriorityHelpOpen(false);
  }, [pathname]);

  const startNewConversation = React.useCallback(() => {
    conversations.newConversation();
    router.push(`/workspace?new=${Date.now()}`);
  }, [conversations, router]);

  const selectConversation = React.useCallback(
    (sessionId: string) => {
      conversations.selectSession(sessionId);
      router.push("/workspace");
    },
    [conversations, router],
  );

  return (
    <div className={cn("surface-grid min-h-screen", isWorkspace && "h-[100dvh] min-h-0 overflow-hidden")}>
      <div
        className={cn(
          "mx-auto flex min-h-screen max-w-[1680px] gap-6 px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-6",
          isWorkspace && "h-full min-h-0 max-w-none gap-0 overflow-hidden p-0 sm:p-0 lg:p-0",
        )}
      >
        {!isWorkspace ? (
          <aside className="sticky top-6 hidden h-[calc(100vh-3rem)] w-[290px] shrink-0 overflow-hidden rounded-[28px] border border-white/60 bg-white/80 shadow-panel backdrop-blur xl:block">
            <ConversationSidebar
              currentSessionId={conversations.currentSessionId}
              loading={conversations.loading}
              sessions={conversations.sessions}
              onDelete={conversations.deleteSession}
              onNew={startNewConversation}
              onRename={conversations.renameSession}
              onSelect={selectConversation}
              locale={locale}
              onToggleLocale={toggleLocale}
              t={t}
            />
          </aside>
        ) : null}

        <main className={cn("min-w-0 flex-1", isWorkspace && "h-full min-h-0 overflow-hidden")}>
          {!isWorkspace ? (
          <div className="sticky top-0 z-40 -mx-3 mb-4 border-b border-white/60 bg-white/90 px-5 py-2 shadow-sm backdrop-blur sm:-mx-4 xl:hidden">
            <div className="flex h-12 items-center justify-between gap-3">
              <button
                type="button"
                aria-label="대화 목록 열기"
                title="대화 목록 열기"
                onClick={() => setMobileMenuOpen(true)}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <NotificationCenter />
              </div>
            </div>
            {priorityHelpDefinitions.length ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-slate-950"
                  aria-expanded={priorityHelpOpen}
                  onClick={() => setPriorityHelpOpen((open) => !open)}
                >
                  <span>P1/P2가 뭔가요?</span>
                  <ChevronDown className={cn("h-4 w-4 text-slate-500 transition", priorityHelpOpen && "rotate-180")} />
                </button>
                {priorityHelpOpen ? (
                  <div className="mt-2 grid gap-2">
                    {priorityHelpDefinitions.map((item) => (
                      <div key={item.label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="text-sm font-semibold text-slate-950">{item.label}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          ) : null}

          {!isWorkspace ? (
            <ConversationSidebarDrawer
              currentSessionId={conversations.currentSessionId}
              loading={conversations.loading}
              open={mobileMenuOpen}
              sessions={conversations.sessions}
              onClose={() => setMobileMenuOpen(false)}
              onDelete={conversations.deleteSession}
              onNew={startNewConversation}
              onRename={conversations.renameSession}
              onSelect={selectConversation}
              locale={locale}
              onToggleLocale={toggleLocale}
              t={t}
            />
          ) : null}

          {false ? (
            <div className="fixed inset-0 z-50 flex xl:hidden">
              <div className="flex h-full w-[min(24rem,88vw)] flex-col overflow-y-auto border-r border-slate-200 bg-white p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-lg font-semibold text-slate-950">FLOWFIT</p>
                  <Button type="button" variant="ghost" size="icon" aria-label="메뉴 닫기" onClick={() => setMobileMenuOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <nav className="mt-6 space-y-1">
                  {primaryNavigation.map((item) => (
                    <ShellNavigationLink
                      key={item.href}
                      item={item}
                      active={isActivePath(pathname, item.href)}
                      onClick={() => setMobileMenuOpen(false)}
                    />
                  ))}
                  {secondaryNavigation.map((item) => (
                    <ShellNavigationLink
                      key={item.href}
                      item={item}
                      active={isActivePath(pathname, item.href)}
                      onClick={() => setMobileMenuOpen(false)}
                    />
                  ))}
                </nav>

                <UserProfilePanel />
              </div>
              <button
                type="button"
                aria-label="메뉴 닫기"
                className="flex-1 bg-slate-950/30 backdrop-blur-sm"
                onClick={() => setMobileMenuOpen(false)}
              />
            </div>
          ) : null}

          {!hideCommonHeader ? (
            <div className="glass-panel mb-6 px-4 py-5 sm:px-6 sm:py-6">
              <div>
                <p className="text-2xl font-semibold tracking-normal text-slate-950 sm:text-4xl">
                  {isApprovalInbox ? "보류된 작업 승인함" : "AI 운영"}
                </p>
              </div>
            </div>
          ) : null}

          <div
            className={cn(
              "space-y-6 pb-10",
              isWorkspace && "h-full min-h-0 overflow-hidden space-y-0 pb-0",
              isSettingsHome &&
                "h-[calc(100dvh-7.25rem)] min-h-0 overflow-y-auto overflow-x-hidden space-y-0 pb-3 xl:h-[calc(100dvh-3rem)]",
            )}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
