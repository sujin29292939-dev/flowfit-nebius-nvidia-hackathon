"use client";

import { Check, ChevronRight, Globe2, MessageSquare, MoreHorizontal, Pencil, Plus, Settings, Trash2, UserRound, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { FlowFitLogoMark } from "@/components/flowfit/FlowFitLogoMark";
import type { FlowFitLocale, FlowFitMessageKey } from "@/hooks/useFlowFitChatI18n";
import { adminNavigation } from "@/lib/navigation";
import type { OperationChatSession } from "@/services/operationChatFileStore";
import { cn } from "@/lib/utils";

type Translate = (key: FlowFitMessageKey, params?: Record<string, string | number>) => string;

type SidebarAction = {
  active?: boolean;
  badge?: string;
  disabled?: boolean;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  shortcut?: string;
};

type ConversationSidebarProps = {
  currentSessionId: string | null;
  loading: boolean;
  onClose?: () => void;
  onDelete: (sessionId: string) => void;
  onNew: () => void;
  onRename: (sessionId: string, title: string) => void | Promise<void | boolean>;
  onSelect: (sessionId: string) => void;
  locale?: FlowFitLocale;
  sessions: OperationChatSession[];
  t: Translate;
  onToggleLocale?: () => void;
};

const profileOperationLinks = adminNavigation.filter((item) => item.href !== "/admin/settings");

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ConversationSidebar({
  currentSessionId,
  loading,
  onClose,
  onDelete,
  onNew,
  onRename,
  onSelect,
  locale = "ko",
  sessions,
  t,
  onToggleLocale,
}: ConversationSidebarProps) {
  const [menuSessionId, setMenuSessionId] = React.useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = React.useState(false);
  const [editingSessionId, setEditingSessionId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");
  const [renamePendingId, setRenamePendingId] = React.useState<string | null>(null);
  const [renameErrorId, setRenameErrorId] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const profileMenuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (editingSessionId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingSessionId]);

  React.useEffect(() => {
    function closeProfileMenu(event: MouseEvent) {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    }

    if (profileMenuOpen) {
      document.addEventListener("mousedown", closeProfileMenu);
    }

    return () => document.removeEventListener("mousedown", closeProfileMenu);
  }, [profileMenuOpen]);

  function startRename(session: OperationChatSession) {
    setMenuSessionId(null);
    setRenameErrorId(null);
    setEditingSessionId(session.id);
    setRenameDraft(session.title);
  }

  async function commitRename(session: OperationChatSession) {
    const nextTitle = renameDraft.trim().replace(/\s+/g, " ");

    if (!nextTitle || nextTitle === session.title) {
      setEditingSessionId(null);
      setRenameDraft("");
      setRenameErrorId(null);
      return;
    }

    setRenamePendingId(session.id);
    setRenameErrorId(null);

    try {
      const result = await onRename(session.id, nextTitle);
      if (result === false) {
        setRenameErrorId(session.id);
        return;
      }
      setEditingSessionId(null);
      setRenameDraft("");
    } catch {
      setRenameErrorId(session.id);
    } finally {
      setRenamePendingId(null);
    }
  }

  function cancelRename() {
    setEditingSessionId(null);
    setRenameDraft("");
    setRenameErrorId(null);
  }

  function remove(session: OperationChatSession) {
    setMenuSessionId(null);
    if (window.confirm(t("deleteConfirm", { title: session.title }))) {
      onDelete(session.id);
    }
  }

  const sidebarActions: SidebarAction[] = [
    { label: "새 채팅", icon: Plus, shortcut: "Ctrl+⇧+O", onClick: onNew, active: true },
  ];

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r border-slate-200 bg-slate-50/80 lg:w-[280px]">
      <div className="shrink-0 border-b border-slate-200 p-2">
        <div className="space-y-1">
          {sidebarActions.map((action) => {
            const Icon = action.icon;

            const className = cn(
              "flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-medium transition",
              action.active
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-700 hover:bg-white hover:text-slate-950",
              action.disabled && "cursor-not-allowed text-slate-400 hover:bg-transparent hover:text-slate-400",
            );
            const content = (
              <>
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    action.active ? "bg-slate-200 text-slate-950" : "text-slate-700",
                    action.disabled && "text-slate-400",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                {action.shortcut ? <span className="text-xs font-medium text-slate-400">{action.shortcut}</span> : null}
                {action.badge ? (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">
                    {action.badge}
                  </span>
                ) : null}
              </>
            );

            if (action.href && !action.disabled) {
              return (
                <Link key={action.label} href={action.href} onClick={onClose} className={className}>
                  {content}
                </Link>
              );
            }

            return (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                className={className}
              >
                {content}
              </button>
            );
          })}
          {onClose ? (
            <button
              type="button"
              aria-label="사이드바 닫기"
              title="사이드바 닫기"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="px-2 pb-2 pt-1 text-xs font-semibold text-slate-400">기존 채팅 세션</div>
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-lg bg-slate-200/70" />
            ))}
          </div>
        ) : sessions.length ? (
          <div className="space-y-1">
            {sessions.map((session) => {
              const active = session.id === currentSessionId;
              const editing = editingSessionId === session.id;
              const renaming = renamePendingId === session.id;

              return (
                <div key={session.id} className="relative">
                  {editing ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void commitRename(session);
                      }}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg bg-white px-3 py-2.5 text-left shadow-sm",
                        renameErrorId === session.id && "ring-1 ring-rose-200",
                      )}
                    >
                      <MessageSquare className="mt-2 h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1">
                        <input
                          ref={inputRef}
                          value={renameDraft}
                          maxLength={80}
                          disabled={renaming}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelRename();
                            }
                          }}
                          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-950 outline-none transition focus:border-slate-400"
                        />
                        {renameErrorId === session.id ? (
                          <span className="mt-1 block text-xs font-medium text-rose-600">{t("failedResponse")}</span>
                        ) : (
                          <span className="mt-1 block text-xs text-slate-400">{formatDate(session.updatedAt)}</span>
                        )}
                      </span>
                      <button
                        type="submit"
                        aria-label={t("rename")}
                        title={t("rename")}
                        disabled={renaming}
                        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white transition hover:bg-slate-800 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("cancel")}
                        title={t("cancel")}
                        disabled={renaming}
                        onClick={cancelRename}
                        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(session.id)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition",
                        active ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:bg-white/80 hover:text-slate-950",
                      )}
                    >
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate pr-7 text-sm font-semibold">{session.title}</span>
                        <span className="mt-1 block text-xs text-slate-400">{formatDate(session.updatedAt)}</span>
                      </span>
                    </button>
                  )}

                  {!editing ? (
                    <button
                      type="button"
                      aria-label={t("conversationMenu")}
                      title={t("conversationMenu")}
                      onClick={() => setMenuSessionId((current) => (current === session.id ? null : session.id))}
                      className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-950"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  ) : null}

                  {menuSessionId === session.id ? (
                    <div className="absolute right-2 top-10 z-30 w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
                      <button
                        type="button"
                        onClick={() => startRename(session)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t("rename")}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(session)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("delete")}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-4 text-center text-sm text-slate-500">{t("noConversations")}</div>
        )}
      </div>

      <div className="relative shrink-0 border-t border-slate-200 p-3" ref={profileMenuRef}>
        {profileMenuOpen ? (
          <div className="absolute inset-x-3 bottom-full z-40 mb-2 max-h-[72vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
            <div className="border-b border-slate-100 pb-1">
              {profileOperationLinks.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onClose?.();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 hover:text-slate-950"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-slate-700" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
            <Link
              href="/admin/settings"
              onClick={() => {
                setProfileMenuOpen(false);
                onClose?.();
              }}
              className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 hover:text-slate-950"
            >
              <Settings className="h-4 w-4 shrink-0 text-slate-700" />
              <span className="min-w-0 flex-1">설정</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                onToggleLocale?.();
                setProfileMenuOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 hover:text-slate-950"
            >
              <Globe2 className="h-4 w-4 shrink-0 text-slate-700" />
              <span className="min-w-0 flex-1">언어</span>
              <span className="text-xs font-semibold text-slate-400">{locale === "ko" ? "KO" : "EN"}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          </div>
        ) : null}

        <button
          type="button"
          aria-expanded={profileMenuOpen}
          aria-label="프로필 메뉴"
          onClick={() => setProfileMenuOpen((current) => !current)}
          className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md"
        >
          <FlowFitLogoMark className="h-10 w-10 rounded-xl border border-slate-200 p-1.5" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-950">FlowFit 대표</span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">대표 계정</span>
          </span>
          <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      </div>
    </aside>
  );
}

export function ConversationSidebarDrawer({
  open,
  onClose,
  onNew,
  onSelect,
  ...props
}: Omit<ConversationSidebarProps, "onClose"> & {
  open: boolean;
  onClose: () => void;
}) {
  React.useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true">
      <button type="button" aria-label="사이드바 닫기" className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-[min(22rem,88vw)] shadow-2xl">
        <ConversationSidebar
          {...props}
          onClose={onClose}
          onNew={() => {
            onNew();
            onClose();
          }}
          onSelect={(sessionId) => {
            onSelect(sessionId);
            onClose();
          }}
        />
      </div>
    </div>
  );
}
