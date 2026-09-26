"use client";

import { ArrowUp, ChevronDown, Menu, Mic, PanelLeftClose, PanelLeftOpen, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import {
  FlowFitRoleControl,
  RestrictedEmployeeView,
  canUseAiOperations,
  useFlowFitRole,
} from "@/components/flowfit/flowfit-access";
import { FlowFitChatWorkspace } from "@/components/flowfit/chat/FlowFitChatWorkspace";
import { ConversationSidebar, ConversationSidebarDrawer } from "@/components/flowfit/chat/ConversationSidebar";
import { AiRunningBoard } from "@/components/flowfit/AiRunningBoard";
import { FlowFitLogoMark } from "@/components/flowfit/FlowFitLogoMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFlowFitChatI18n } from "@/hooks/useFlowFitChatI18n";
import { useFlowFitConversations } from "@/hooks/useFlowFitConversations";
import { cn } from "@/lib/utils";
import type { OperationChatSession } from "@/services/operationChatFileStore";

type ShortcutTone = "sky" | "emerald" | "amber" | "rose" | "violet" | "teal" | "slate";

type RequestAction = {
  id: string;
  label: string;
  prompt: string;
};

type RequestShortcut = {
  id: string;
  label: string;
  tone: ShortcutTone;
  actions: RequestAction[];
};

const CUSTOM_SHORTCUTS_KEY = "flowfit-custom-request-shortcuts";
const DELETED_DEFAULT_SHORTCUTS_KEY = "flowfit-deleted-default-request-shortcuts";

const defaultShortcuts: RequestShortcut[] = [
  {
    id: "delivery",
    label: "배송",
    tone: "sky",
    actions: [
      { id: "delay", label: "지연 안내", prompt: "오늘 들어온 고객 문의 중 배송 지연 관련 건만 정리하고, 고객에게 보낼 안내 문자를 초안으로 만들어줘." },
      { id: "tracking", label: "배송 조회", prompt: "배송 상태 확인이 필요한 주문을 찾아 현재 상태와 확인이 필요한 항목을 정리해줘." },
      { id: "change", label: "변경 요청", prompt: "배송지 또는 배송일 변경 요청을 모아 처리 가능 여부와 승인 필요한 건을 구분해줘." },
      { id: "staff", label: "담당 확인", prompt: "배송 관련해 담당자 확인이 필요한 건을 골라 직원 확인 요청 초안을 만들어줘." },
    ],
  },
  {
    id: "order",
    label: "발주",
    tone: "emerald",
    actions: [
      { id: "missing", label: "누락 확인", prompt: "A거래처 발주 누락 여부를 확인하고, 필요하면 담당자에게 확인 요청을 보낼 초안을 만들어줘." },
      { id: "new", label: "추가 주문", prompt: "오늘 들어온 추가 주문 요청을 정리하고, 재고와 납기 확인이 필요한 항목을 표시해줘." },
      { id: "document", label: "발주서 정리", prompt: "접수된 발주서 내용을 거래처, 품목, 수량, 납기 기준으로 정리해줘." },
      { id: "reply", label: "거래처 답장", prompt: "발주 관련 거래처에 보낼 답장 초안을 만들고, 외부 발송 전 승인 필요 여부를 표시해줘." },
    ],
  },
  {
    id: "reply",
    label: "답장",
    tone: "amber",
    actions: [
      { id: "unanswered", label: "미응답", prompt: "어제 미응답 고객에게 보낼 안내 문자 초안을 만들어줘." },
      { id: "apology", label: "사과문", prompt: "고객 불만 가능성이 있는 문의를 골라 사과와 재안내 시간이 포함된 답장 초안을 만들어줘." },
      { id: "quote", label: "견적 답변", prompt: "견적 요청 문의를 정리하고 고객에게 보낼 견적 안내 답장 초안을 만들어줘." },
      { id: "short", label: "짧은 답장", prompt: "반복적으로 들어온 단순 문의에 대해 짧고 안전한 답장 초안을 만들어줘." },
    ],
  },
  {
    id: "stock",
    label: "재고",
    tone: "rose",
    actions: [
      { id: "shortage", label: "부족 품목", prompt: "재고 부족 품목을 정리해서 대표 보고용 요약 보고서로 만들어줘." },
      { id: "order-needed", label: "발주 필요", prompt: "기준치 이하 재고를 찾아 발주가 필요한 품목과 우선순위를 정리해줘." },
      { id: "mismatch", label: "재고 이상", prompt: "현장 접수나 파일에서 재고 이상 가능성이 있는 건을 찾아 확인 필요한 항목을 표시해줘." },
      { id: "daily", label: "일일 보고", prompt: "오늘 재고 변동과 부족 위험을 짧은 일일 보고로 정리해줘." },
    ],
  },
  {
    id: "auto",
    label: "자동화",
    tone: "violet",
    actions: [
      { id: "morning", label: "오전 점검", prompt: "매일 오전 9시에 미처리 문의를 정리하는 자동화 초안을 만들어줘." },
      { id: "followup", label: "미응답 정리", prompt: "24시간 이상 미응답 문의를 매일 자동으로 정리하는 규칙을 만들어줘." },
      { id: "receivable", label: "미수 알림", prompt: "미수금이 일정 기간을 넘으면 대표 승인함에 알림을 올리는 자동화 초안을 만들어줘." },
      { id: "inventory", label: "재고 알림", prompt: "재고가 기준치 아래로 내려가면 자동으로 보고서를 만드는 규칙을 만들어줘." },
    ],
  },
  {
    id: "claim",
    label: "클레임",
    tone: "teal",
    actions: [
      { id: "risk", label: "위험 분류", prompt: "오늘 접수된 고객 문의 중 클레임 가능성이 높은 건을 분류해줘." },
      { id: "draft", label: "응대 초안", prompt: "고객 클레임 건에 대해 사과, 현재 조치, 재안내 시간을 포함한 응대 초안을 만들어줘." },
      { id: "staff", label: "직원 확인", prompt: "클레임 처리에 필요한 내부 확인 사항을 직원 확인 요청 초안으로 만들어줘." },
      { id: "report", label: "대표 보고", prompt: "오늘 클레임 이슈를 원인, 위험도, 필요한 결정 기준으로 대표 보고용으로 정리해줘." },
    ],
  },
  {
    id: "exception",
    label: "예외접수",
    tone: "rose",
    actions: [
      { id: "refund", label: "환불 안내", prompt: "환불 요청이 들어왔어. 예외접수함 기준에 맞는 접수 링크와 안내 내용을 보여줘." },
      { id: "cancel", label: "취소 안내", prompt: "취소 요청이 들어왔어. 예외접수함 기준에 맞는 접수 링크와 안내 내용을 보여줘." },
      { id: "dispute", label: "분쟁 안내", prompt: "분쟁 가능성이 있는 고객 문의가 들어왔어. 예외접수함 기준에 맞는 접수 링크와 안내 내용을 보여줘." },
      { id: "damage", label: "파손 안내", prompt: "파손 문의가 들어왔어. 예외접수함 기준에 맞는 접수 링크와 안내 내용을 보여줘." },
    ],
  },
  {
    id: "report",
    label: "보고",
    tone: "slate",
    actions: [
      { id: "today", label: "오늘 요약", prompt: "오늘 처리해야 할 운영 이슈를 대표 보고용으로 짧게 정리해줘." },
      { id: "approval", label: "승인 대기", prompt: "현재 승인 대기 중인 AI 작업을 중요도 순서로 정리해줘." },
      { id: "auto-log", label: "자동 처리", prompt: "오늘 자동 처리된 업무와 승인 없이 처리된 이유를 정리해줘." },
      { id: "staff", label: "직원 확인", prompt: "직원 확인 요청 중 응답 대기 상태인 건을 모아 다음 조치를 제안해줘." },
    ],
  },
  {
    id: "fixed-setting-dunning",
    label: "미수금",
    tone: "rose",
    actions: [
      {
        id: "dunning-setting",
        label: "P1 금액",
        prompt: "P1 금액 기준 300만원으로 바꿔줘.",
      },
    ],
  },
  {
    id: "fixed-setting-delivery",
    label: "납기",
    tone: "sky",
    actions: [
      {
        id: "delivery-setting",
        label: "지연 판정",
        prompt: "납기 지연 판정일을 2일로 설정해줘.",
      },
    ],
  },
  {
    id: "fixed-setting-account-health",
    label: "거래처",
    tone: "emerald",
    actions: [
      {
        id: "account-health-setting",
        label: "건강 점수",
        prompt: "거래처 건강 주의 점수를 65로 설정해줘.",
      },
    ],
  },
  {
    id: "fixed-setting-pricing",
    label: "단가",
    tone: "amber",
    actions: [
      {
        id: "pricing-setting",
        label: "변동률",
        prompt: "단가 심각 변동률을 12%로 바꿔줘.",
      },
    ],
  },
  {
    id: "fixed-setting-claims",
    label: "클레임",
    tone: "teal",
    actions: [
      {
        id: "claims-setting",
        label: "누적 경고",
        prompt: "클레임 누적 경고 기준을 5건으로 바꿔줘.",
      },
    ],
  },
];

const customShortcutTones: ShortcutTone[] = ["sky", "emerald", "amber", "rose", "violet", "teal", "slate"];

const fixedKeywordCards: RequestShortcut[] = [
  {
    id: "fixed-auto-criteria",
    label: "자동 기준",
    tone: "violet",
    actions: [
      {
        id: "auto-keyword",
        label: "키워드 추가",
        prompt: "배송 문의를 자동 처리 기준에 추가해줘.",
      },
    ],
  },
  {
    id: "fixed-approval-guard",
    label: "승인 기준",
    tone: "rose",
    actions: [
      {
        id: "approval-keyword",
        label: "승인함 기준",
        prompt: "환불 요청은 자동 처리하지 말고 승인함으로 보낼 기준에 추가해줘.",
      },
    ],
  },
  {
    id: "fixed-internal-record",
    label: "기록 저장",
    tone: "sky",
    actions: [
      {
        id: "record-keyword",
        label: "내부 기록",
        prompt: "처리 결과 저장을 내부 기록 저장 자동 처리 기준에 추가해줘.",
      },
    ],
  },
  {
    id: "fixed-repeat-reminder",
    label: "반복 알림",
    tone: "emerald",
    actions: [
      {
        id: "reminder-keyword",
        label: "알림 기준",
        prompt: "미응답 알림을 반복 알림 자동 처리 기준에 추가해줘.",
      },
    ],
  },
];

function buildCustomPrompt(label: string) {
  return `${label} 관련 반복 운영 업무를 확인하고 필요한 결과를 만들어줘.`;
}

function normalizeShortcut(input: Partial<RequestShortcut>, index: number): RequestShortcut | null {
  const label = typeof input.label === "string" ? input.label.trim().slice(0, 8) : "";
  if (!label) return null;
  const prompt =
    Array.isArray(input.actions) && input.actions[0]?.prompt
      ? input.actions[0].prompt
      : typeof (input as { prompt?: unknown }).prompt === "string"
        ? String((input as { prompt: string }).prompt)
        : buildCustomPrompt(label);

  return {
    id: typeof input.id === "string" ? input.id : `custom-${index}`,
    label,
    tone: customShortcutTones[index % customShortcutTones.length],
    actions: [{ id: "basic", label: "기본", prompt }],
  };
}

function readCustomShortcuts() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(CUSTOM_SHORTCUTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<RequestShortcut>[]) : [];
    return Array.isArray(parsed)
      ? parsed.map(normalizeShortcut).filter((shortcut): shortcut is RequestShortcut => Boolean(shortcut))
      : [];
  } catch {
    return [];
  }
}

function saveCustomShortcuts(shortcuts: RequestShortcut[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOM_SHORTCUTS_KEY, JSON.stringify(shortcuts));
}

function readDeletedDefaultShortcutIds() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(DELETED_DEFAULT_SHORTCUTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveDeletedDefaultShortcutIds(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DELETED_DEFAULT_SHORTCUTS_KEY, JSON.stringify(ids));
}

export function AiOperationRoom({
  initialView = "start",
  newChatKey = null,
  summarySlot,
}: {
  initialView?: "start" | "ai-running";
  newChatKey?: string | null;
  summarySlot?: React.ReactNode;
}) {
  const router = useRouter();
  const { role, setRole } = useFlowFitRole();
  const { locale, t, toggleLocale } = useFlowFitChatI18n();
  const conversations = useFlowFitConversations(newChatKey ?? "workspace-main");
  const [chatLoading, setChatLoading] = React.useState(false);
  const [chatDraft, setChatDraft] = React.useState("");
  const [desktopSidebarOpen, setDesktopSidebarOpen] = React.useState(true);
  const [showChatWorkspace, setShowChatWorkspace] = React.useState(false);
  const [showRunningBoard, setShowRunningBoard] = React.useState(initialView === "ai-running");
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const [handoffPrompt, setHandoffPrompt] = React.useState<{ id: string; prompt: string } | null>(null);
  const keepChatOnRouteChangeRef = React.useRef(false);

  React.useEffect(() => {
    if (initialView === "ai-running") {
      setShowRunningBoard(true);
      setShowChatWorkspace(false);
      setHandoffPrompt(null);
      setChatDraft("");
      return;
    }

    setShowRunningBoard(false);
  }, [initialView]);

  React.useEffect(() => {
    if (keepChatOnRouteChangeRef.current) {
      keepChatOnRouteChangeRef.current = false;
      return;
    }

    setShowChatWorkspace(false);
    setHandoffPrompt(null);
    setChatDraft("");
  }, [newChatKey]);

  function submitChat(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return;

    setChatLoading(false);
    setChatDraft("");
    setShowRunningBoard(false);
    setHandoffPrompt({
      id: `start-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prompt: trimmed,
    });
    setShowChatWorkspace(true);
    keepChatOnRouteChangeRef.current = true;
    router.replace("/workspace");
  }

  if (!canUseAiOperations(role)) {
    return (
      <div className="space-y-4">
        <FlowFitRoleControl role={role} onChange={setRole} />
        <RestrictedEmployeeView />
      </div>
    );
  }

  function startNewConversation() {
    conversations.newConversation();
    setHandoffPrompt(null);
    setShowChatWorkspace(false);
    setShowRunningBoard(false);
    setChatDraft("");
    router.replace("/workspace");
  }

  function selectConversation(sessionId: string) {
    conversations.selectSession(sessionId);
    setHandoffPrompt(null);
    setShowRunningBoard(false);
    setShowChatWorkspace(true);
    setChatDraft("");
    keepChatOnRouteChangeRef.current = true;
    router.replace("/workspace");
  }

  async function deleteConversation(sessionId: string) {
    await conversations.deleteSession(sessionId);
    if (conversations.currentSessionId === sessionId) {
      setShowChatWorkspace(false);
      setShowRunningBoard(false);
      setChatDraft("");
    }
  }

  if (showChatWorkspace) {
    return (
      <FlowFitChatWorkspace
        newChatKey={handoffPrompt ? handoffPrompt.id : undefined}
        initialPrompt={handoffPrompt?.prompt}
        initialPromptKey={handoffPrompt?.id}
        summarySlot={summarySlot}
      />
    );
  }

  if (showRunningBoard) {
    return (
      <section
        className={cn(
          "grid h-full min-h-0 max-h-[100dvh] w-full grid-cols-1 overflow-hidden bg-transparent",
          desktopSidebarOpen ? "lg:grid-cols-[280px_minmax(0,1fr)]" : "lg:grid-cols-1",
        )}
      >
        <ConversationSidebarDrawer
          currentSessionId={null}
          loading={conversations.loading}
          open={mobileSidebarOpen}
          sessions={conversations.sessions}
          onClose={() => setMobileSidebarOpen(false)}
          onDelete={deleteConversation}
          onNew={startNewConversation}
          onRename={conversations.renameSession}
          onSelect={selectConversation}
          locale={locale}
          onToggleLocale={toggleLocale}
          t={t}
        />
        {desktopSidebarOpen ? (
        <div className="hidden min-h-0 lg:block">
          <ConversationSidebar
            currentSessionId={null}
            loading={conversations.loading}
            sessions={conversations.sessions}
            onDelete={deleteConversation}
            onNew={startNewConversation}
            onRename={conversations.renameSession}
            onSelect={selectConversation}
            locale={locale}
            onToggleLocale={toggleLocale}
            t={t}
          />
        </div>
        ) : null}

        <div className="relative min-h-0 overflow-y-auto pb-8">
          <div className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200/70 bg-white/85 px-5 text-slate-700 shadow-sm shadow-slate-200/40 backdrop-blur lg:hidden relative">
            <button
              type="button"
              aria-label="대화 목록 열기"
              title="대화 목록 열기"
              onClick={() => setMobileSidebarOpen(true)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
            >
              <Menu className="h-5 w-5" />
            </button>
            <FlowFitLogoMark className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 bg-transparent p-0" />
            <div className="h-12 w-12 shrink-0" aria-hidden="true" />
          </div>
          <div className="pointer-events-none sticky top-4 z-30 hidden h-0 px-4 lg:block">
            <button
              type="button"
              aria-label={desktopSidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
              title={desktopSidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
              onClick={() => setDesktopSidebarOpen((current) => !current)}
              className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-600 shadow-sm backdrop-blur transition hover:border-slate-300 hover:text-slate-950"
            >
              {desktopSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>
          </div>
          <div className="mx-auto w-full max-w-5xl px-4 py-6 lg:py-8">
            <AiRunningBoard />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "grid h-full min-h-0 max-h-[100dvh] w-full grid-cols-1 overflow-hidden bg-transparent",
        desktopSidebarOpen ? "lg:grid-cols-[280px_minmax(0,1fr)]" : "lg:grid-cols-1",
      )}
    >
      <ConversationSidebarDrawer
        currentSessionId={null}
        loading={conversations.loading}
        open={mobileSidebarOpen}
        sessions={conversations.sessions}
        onClose={() => setMobileSidebarOpen(false)}
        onDelete={deleteConversation}
        onNew={startNewConversation}
        onRename={conversations.renameSession}
        onSelect={selectConversation}
        locale={locale}
        onToggleLocale={toggleLocale}
        t={t}
      />
      {desktopSidebarOpen ? (
      <div className="hidden min-h-0 lg:block">
        <ConversationSidebar
          currentSessionId={null}
          loading={conversations.loading}
          sessions={conversations.sessions}
          onDelete={deleteConversation}
          onNew={startNewConversation}
          onRename={conversations.renameSession}
          onSelect={selectConversation}
          locale={locale}
          onToggleLocale={toggleLocale}
          t={t}
        />
      </div>
      ) : null}

      <div className="relative min-h-0 overflow-y-auto pb-8">
        <div className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200/70 bg-white/85 px-5 text-slate-700 shadow-sm shadow-slate-200/40 backdrop-blur lg:hidden relative">
          <button
            type="button"
            aria-label="대화 목록 열기"
            title="대화 목록 열기"
            onClick={() => setMobileSidebarOpen(true)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
          >
            <Menu className="h-5 w-5" />
          </button>
          <FlowFitLogoMark className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 bg-transparent p-0" />
          <div className="h-12 w-12 shrink-0" aria-hidden="true" />
        </div>
        <div className="pointer-events-none sticky top-4 z-30 hidden h-0 px-4 lg:block">
          <button
            type="button"
            aria-label={desktopSidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
            title={desktopSidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
            onClick={() => setDesktopSidebarOpen((current) => !current)}
            className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-600 shadow-sm backdrop-blur transition hover:border-slate-300 hover:text-slate-950"
          >
            {desktopSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
        </div>
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center gap-6 px-1 pt-6 sm:px-4 lg:pt-8">
          <StartChatWindow
            value={chatDraft}
            onChange={setChatDraft}
            onSubmit={submitChat}
            loading={chatLoading}
            summarySlot={summarySlot}
          />
        </div>
      </div>
    </section>
  );
}

function StartChatWindow({
  value,
  onChange,
  onSubmit,
  loading,
  summarySlot,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  loading: boolean;
  summarySlot?: React.ReactNode;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [customShortcuts, setCustomShortcuts] = React.useState<RequestShortcut[]>([]);
  const [deletedDefaultShortcutIds, setDeletedDefaultShortcutIds] = React.useState<string[]>([]);
  const [newShortcutLabel, setNewShortcutLabel] = React.useState("");
  const [showAddShortcut, setShowAddShortcut] = React.useState(false);
  const [selectedShortcut, setSelectedShortcut] = React.useState<RequestShortcut | null>(null);
  const [selectedAction, setSelectedAction] = React.useState<RequestAction | null>(null);

  const visibleFixedKeywordCards = fixedKeywordCards.filter((shortcut) => !deletedDefaultShortcutIds.includes(shortcut.id));
  const visibleDefaultShortcuts = defaultShortcuts.filter((shortcut) => !deletedDefaultShortcutIds.includes(shortcut.id));
  const shortcuts = [...visibleFixedKeywordCards, ...visibleDefaultShortcuts, ...customShortcuts];

  React.useEffect(() => {
    setCustomShortcuts(readCustomShortcuts());
    setDeletedDefaultShortcutIds(readDeletedDefaultShortcutIds());
    inputRef.current?.focus();
  }, []);

  function submit(input = value) {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    onChange("");
    void onSubmit(trimmed);
  }

  function selectShortcut(shortcut: RequestShortcut) {
    if (selectedShortcut?.id === shortcut.id) {
      setSelectedShortcut(null);
      setSelectedAction(null);
      onChange("");
      inputRef.current?.focus();
      return;
    }

    const action = shortcut.actions[0];
    setSelectedShortcut(shortcut);
    setSelectedAction(action);
    onChange(action.prompt);
    inputRef.current?.focus();
  }

  function selectAction(action: RequestAction) {
    setSelectedAction(action);
    onChange(action.prompt);
  }

  function addShortcut() {
    const label = newShortcutLabel.trim().slice(0, 8);
    if (!label) return;

    if (shortcuts.some((shortcut) => shortcut.label === label)) {
      setNewShortcutLabel("");
      return;
    }

    const nextShortcut: RequestShortcut = {
      id: `custom-${Date.now()}`,
      label,
      tone: customShortcutTones[customShortcuts.length % customShortcutTones.length],
      actions: [{ id: "basic", label: "기본", prompt: buildCustomPrompt(label) }],
    };
    const nextShortcuts = [...customShortcuts, nextShortcut];
    setCustomShortcuts(nextShortcuts);
    saveCustomShortcuts(nextShortcuts);
    setSelectedShortcut(nextShortcut);
    setSelectedAction(nextShortcut.actions[0]);
    onChange(nextShortcut.actions[0].prompt);
    setNewShortcutLabel("");
    setShowAddShortcut(false);
  }

  function deleteSelectedShortcut() {
    const target = selectedShortcut;
    if (!target || loading) return;

    const isCustomShortcut = customShortcuts.some((shortcut) => shortcut.id === target.id);

    if (isCustomShortcut) {
      const nextShortcuts = customShortcuts.filter((shortcut) => shortcut.id !== target.id);
      setCustomShortcuts(nextShortcuts);
      saveCustomShortcuts(nextShortcuts);
    } else {
      const nextDeletedIds = Array.from(new Set([...deletedDefaultShortcutIds, target.id]));
      setDeletedDefaultShortcutIds(nextDeletedIds);
      saveDeletedDefaultShortcutIds(nextDeletedIds);
    }

    setSelectedShortcut(null);
    setSelectedAction(null);
    onChange("");
    inputRef.current?.focus();
  }

  return (
    <section className="mx-auto w-full max-w-5xl">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-3xl font-semibold tracking-normal text-slate-950 sm:text-5xl">무엇을 도와드릴까요?</h1>

        <div className="mt-8 rounded-[28px] bg-[#303030] p-2 text-left text-zinc-100 shadow-2xl">
          <div className="flex items-center gap-2 rounded-full border border-zinc-600 bg-[#343436] px-2 py-2">
            <button
              type="button"
              aria-label="추가"
              title="추가"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-200 transition hover:bg-white/10"
            >
              <Plus className="h-4 w-4" />
            </button>
            <input
              ref={inputRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              placeholder="작업을 할당하거나 무엇이든 질문하세요"
              disabled={loading}
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:cursor-wait"
            />
            <button type="button" className="hidden shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs text-zinc-100 transition hover:bg-white/10 sm:inline-flex">
              확장
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button type="button" aria-label="음성 입력" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-200 transition hover:bg-white/10">
              <Mic className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="요청 보내기"
              onClick={() => submit()}
              disabled={loading || !value.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-zinc-950 transition hover:bg-zinc-100 disabled:bg-zinc-600 disabled:text-zinc-400"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="hidden">
        <div className="mb-4 flex items-center justify-center gap-2">
          <div className="rounded-2xl bg-violet-50 p-2 text-violet-700">
            <Sparkles className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-slate-950">고정 키워드</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {fixedKeywordCards.map((shortcut) => (
            <ShortcutTile
              key={shortcut.id}
              shortcut={shortcut}
              selected={selectedShortcut?.id === shortcut.id}
              disabled={loading}
              onSelect={selectShortcut}
            />
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-center gap-2">
          <div className="rounded-2xl bg-sky-50 p-2 text-sky-700">
            <Sparkles className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-slate-950">자주 쓰는 요청</p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {shortcuts.map((shortcut) => (
            <ShortcutTile
              key={shortcut.id}
              shortcut={shortcut}
              selected={selectedShortcut?.id === shortcut.id}
              disabled={loading}
              onSelect={selectShortcut}
            />
          ))}
        </div>

        {showAddShortcut ? (
          <div className="mx-auto mt-3 flex max-w-xl flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 sm:flex-row sm:items-center">
            <Input
              value={newShortcutLabel}
              onChange={(event) => setNewShortcutLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addShortcut();
                if (event.key === "Escape") {
                  setShowAddShortcut(false);
                  setNewShortcutLabel("");
                }
              }}
              maxLength={8}
              autoFocus
              placeholder="키워드 이름"
              className="h-9 flex-1 rounded-xl border-0 bg-white shadow-none"
            />
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={() => setShowAddShortcut(false)}>
                닫기
              </Button>
              <Button type="button" size="sm" className="rounded-xl" onClick={addShortcut} disabled={!newShortcutLabel.trim()}>
                추가
              </Button>
            </div>
          </div>
        ) : (
          <div className="mx-auto mt-3 flex w-fit flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddShortcut(true)}
              className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
            >
              <Plus className="h-3.5 w-3.5" />
              키워드 추가
            </button>
            <button
              type="button"
              onClick={deleteSelectedShortcut}
              disabled={!selectedShortcut || loading}
              className="flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-200 disabled:text-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              키워드 삭제
            </button>
          </div>
        )}

        {selectedShortcut && selectedAction ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">{selectedShortcut.label} 세부 기능</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              {selectedShortcut.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => selectAction(action)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                    selectedAction.id === action.id
                      ? "border-slate-950 bg-white text-slate-950"
                      : "border-slate-200 bg-white/70 text-slate-600 hover:text-slate-950"
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-2xl bg-white p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">요청 내용 설계</p>
                  <p className="text-sm font-semibold text-slate-950">
                    {selectedShortcut.label} / {selectedAction.label}
                  </p>
                </div>
                <span className="text-xs font-semibold text-slate-500">기본 문장</span>
              </div>
              <textarea
                value={value || selectedAction.prompt}
                onChange={(event) => onChange(event.target.value)}
                rows={4}
                className="mt-3 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-slate-400"
              />
              <div className="mt-3 flex justify-end">
                <Button type="button" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={loading} onClick={() => submit(value || selectedAction.prompt)}>
                  요청 실행
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {summarySlot ? <div className="mt-6">{summarySlot}</div> : null}
    </section>
  );
}

function OperationChatWindow({
  value,
  onChange,
  onSubmit,
  session,
  loading,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  session: OperationChatSession | null;
  loading: boolean;
}) {
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const messages = session?.messages ?? [];

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, loading]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;

    onChange("");
    void onSubmit(trimmed);
  }

  return (
    <section className="flex min-h-[min(680px,calc(100vh-8rem))] w-full flex-col rounded-[30px] bg-[#303030] p-3 text-left text-zinc-100 shadow-2xl sm:p-4">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-4 pt-1 sm:px-2">
        {messages.length ? (
          messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[86%] whitespace-pre-line rounded-3xl px-4 py-3 text-sm leading-6 sm:max-w-[78%] ${
                  message.role === "user"
                    ? "bg-white text-zinc-950"
                    : "bg-[#3a3a3c] text-zinc-100"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))
        ) : (
          <div className="flex h-full min-h-[360px] items-center justify-center px-4 text-center">
            <p className="text-sm text-zinc-400">작업을 할당하거나 무엇이든 질문하세요</p>
          </div>
        )}
        {loading ? <p className="px-2 text-sm text-zinc-400">AI가 답변을 준비하고 있습니다...</p> : null}
        <div ref={messagesEndRef} />
      </div>

      <div className="rounded-[26px] bg-[#343436] p-3">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="작업을 할당하거나 무엇이든 질문하세요"
          disabled={loading}
          rows={3}
          className="min-h-[72px] w-full resize-none border-0 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:cursor-wait"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            aria-label="추가"
            title="추가"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-200 transition hover:bg-white/10"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="hidden h-9 shrink-0 items-center gap-1 rounded-full px-3 text-xs text-zinc-200 transition hover:bg-white/10 sm:inline-flex"
          >
            확장
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="음성 입력"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-200 transition hover:bg-white/10"
          >
            <Mic className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="요청 보내기"
            onClick={submit}
            disabled={loading || !value.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-zinc-950 transition hover:bg-zinc-100 disabled:bg-zinc-600 disabled:text-zinc-400"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

function ShortcutTile({
  shortcut,
  selected,
  onSelect,
  disabled = false,
}: {
  shortcut: RequestShortcut;
  selected: boolean;
  disabled?: boolean;
  onSelect: (shortcut: RequestShortcut) => void | Promise<void>;
}) {
  const toneClass = {
    sky: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    amber: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    rose: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
    violet: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
    teal: "border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100",
    slate: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
  }[shortcut.tone];

  return (
    <button
      type="button"
      title={`${shortcut.label} 세부 기능 보기`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => void onSelect(shortcut)}
      className={`h-16 w-16 rounded-xl border p-1 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-sm disabled:cursor-wait disabled:opacity-60 ${
        selected ? "ring-2 ring-slate-950 ring-offset-2" : ""
      } ${toneClass}`}
    >
      {shortcut.label}
    </button>
  );
}
