"use client";

import { AlertCircle, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { ArtifactCanvas } from "@/components/flowfit/chat/ArtifactCanvas";
import { Composer } from "@/components/flowfit/chat/Composer";
import { ConversationSidebar, ConversationSidebarDrawer } from "@/components/flowfit/chat/ConversationSidebar";
import { MessageList } from "@/components/flowfit/chat/MessageList";
import { SuggestionChips } from "@/components/flowfit/chat/SuggestionChips";
import { extractArtifact } from "@/components/flowfit/chat/artifact-utils";
import { NotificationCenter } from "@/components/shared/app-shell";
import { useFlowFitChatI18n } from "@/hooks/useFlowFitChatI18n";
import { useFlowFitConversations } from "@/hooks/useFlowFitConversations";
import { useFlowFitStreamingChat } from "@/hooks/useFlowFitStreamingChat";
import { useFlowFitSpeechSynthesis } from "@/hooks/useFlowFitVoice";
import { cn } from "@/lib/utils";

export function FlowFitChatWorkspace({
  initialPrompt,
  initialPromptKey,
  newChatKey,
  summarySlot,
}: {
  initialPrompt?: string;
  initialPromptKey?: string;
  newChatKey?: string | null;
  summarySlot?: React.ReactNode;
}) {
  const router = useRouter();
  const { locale, t, toggleLocale } = useFlowFitChatI18n();
  const conversations = useFlowFitConversations(newChatKey);
  const chat = useFlowFitStreamingChat({
    locale,
    session: conversations.currentSession,
    onSessionUpdate: conversations.upsertSession,
    t,
  });
  const speech = useFlowFitSpeechSynthesis(locale);
  const showSuggestions = !chat.messages.length && !chat.isGenerating;
  const lastAssistant = [...chat.messages].reverse().find((message) => message.role === "assistant");
  const artifact = React.useMemo(
    () => (lastAssistant?.isComplete ? extractArtifact(lastAssistant.content) : null),
    [lastAssistant?.content, lastAssistant?.isComplete],
  );
  const [artifactOpen, setArtifactOpen] = React.useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = React.useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const initialPromptSentRef = React.useRef<string | null>(null);
  const spokenMessageIdRef = React.useRef<string | null>(null);
  const startNewConversation = React.useCallback(() => {
    router.push(`/workspace?new=${Date.now()}`);
  }, [router]);

  React.useEffect(() => {
    if (artifact) setArtifactOpen(true);
  }, [artifact?.code]);

  React.useEffect(() => {
    if (!lastAssistant?.isComplete || lastAssistant.isStreaming || !speech.enabled) return;
    if (spokenMessageIdRef.current === lastAssistant.id) return;
    spokenMessageIdRef.current = lastAssistant.id;
    speech.speak(lastAssistant.content);
  }, [lastAssistant?.content, lastAssistant?.id, lastAssistant?.isComplete, lastAssistant?.isStreaming, speech]);

  React.useEffect(() => {
    const prompt = initialPrompt?.trim();
    const key = initialPromptKey ?? prompt;
    if (!prompt || !key || chat.isGenerating || initialPromptSentRef.current === key) return;

    initialPromptSentRef.current = key;
    void chat.send(prompt);
  }, [chat, chat.isGenerating, initialPrompt, initialPromptKey]);

  return (
    <section className="h-full min-h-0 max-h-[100dvh] w-full max-w-none overflow-hidden border-0 bg-white shadow-none">
      <ConversationSidebarDrawer
        currentSessionId={conversations.currentSessionId}
        loading={conversations.loading}
        open={mobileSidebarOpen}
        sessions={conversations.sessions}
        onClose={() => setMobileSidebarOpen(false)}
        onDelete={conversations.deleteSession}
        onNew={startNewConversation}
        onRename={conversations.renameSession}
        onSelect={conversations.selectSession}
        locale={locale}
        onToggleLocale={toggleLocale}
        t={t}
      />
      <div
        className={cn(
          "grid h-full min-h-0 grid-rows-[auto_1fr] lg:grid-rows-1",
          desktopSidebarOpen ? "lg:grid-cols-[280px_1fr]" : "lg:grid-cols-1",
        )}
      >
        {desktopSidebarOpen ? (
        <div className="hidden min-h-0 lg:block">
          <ConversationSidebar
            currentSessionId={conversations.currentSessionId}
            loading={conversations.loading}
            sessions={conversations.sessions}
            onDelete={conversations.deleteSession}
            onNew={startNewConversation}
            onRename={conversations.renameSession}
            onSelect={conversations.selectSession}
            locale={locale}
            onToggleLocale={toggleLocale}
            t={t}
          />
        </div>
        ) : null}

        <div className={cn("grid h-full min-h-0 overflow-hidden", artifactOpen && artifact ? "xl:grid-cols-[minmax(0,1fr)_460px]" : "grid-cols-1")}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <header className="relative flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="대화 목록 열기"
                  title="대화 목록 열기"
                  onClick={() => setMobileSidebarOpen(true)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 lg:hidden"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label={desktopSidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
                  title={desktopSidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
                  onClick={() => setDesktopSidebarOpen((current) => !current)}
                  className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:text-slate-950 lg:flex"
                >
                  {desktopSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                </button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-950">
                    {conversations.currentSession?.title ?? t("newFlowFitChat")}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <NotificationCenter />
            </div>
          </header>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {showSuggestions ? (
              <div className="absolute inset-x-4 top-4 z-10 mx-auto max-w-3xl sm:top-8">
                <SuggestionChips disabled={chat.isGenerating} onSelect={(prompt) => void chat.send(prompt)} t={t} />
                {summarySlot ? <div className="mt-4 hidden lg:block">{summarySlot}</div> : null}
              </div>
            ) : null}
            <MessageList
              messages={chat.messages}
              isGenerating={chat.isGenerating}
              onApprovalAction={chat.runApprovalAction}
              onRegenerate={chat.regenerate}
              showEmptyState={!showSuggestions}
              t={t}
            />
          </div>

          {chat.error ? (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 sm:px-6">
              <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
                <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-amber-800">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="truncate">{chat.error}</span>
                </p>
                <button
                  type="button"
                  onClick={chat.retry}
                  disabled={chat.isGenerating}
                  className="shrink-0 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-800 disabled:opacity-50"
                >
                  {t("retry")}
                </button>
              </div>
            </div>
          ) : null}

          <Composer
            isGenerating={chat.isGenerating}
            locale={locale}
            onSend={(message, attachments) => void chat.send(message, attachments)}
            onStop={chat.stop}
            onToggleTts={speech.toggle}
            t={t}
            ttsEnabled={speech.enabled}
            ttsSupported={speech.isSupported}
          />
        </div>
        {artifactOpen && artifact ? <ArtifactCanvas artifact={artifact} onClose={() => setArtifactOpen(false)} t={t} /> : null}
        </div>
      </div>
    </section>
  );
}
