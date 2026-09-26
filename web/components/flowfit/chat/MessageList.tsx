"use client";

import { MessageSquareText } from "lucide-react";

import { Message } from "@/components/flowfit/chat/Message";
import type { ApprovalCardActionRequest } from "@/components/flowfit/chat/ApprovalCard";
import { ScrollToBottomButton } from "@/components/flowfit/chat/ScrollToBottomButton";
import { useFlowFitAutoScroll } from "@/hooks/useFlowFitAutoScroll";
import type { FlowFitMessageKey } from "@/hooks/useFlowFitChatI18n";
import type { FlowFitChatMessage } from "@/hooks/useFlowFitStreamingChat";

type Translate = (key: FlowFitMessageKey, params?: Record<string, string | number>) => string;

export function MessageList({
  messages,
  isGenerating,
  onRegenerate,
  onApprovalAction,
  showEmptyState = true,
  t,
}: {
  messages: FlowFitChatMessage[];
  isGenerating: boolean;
  onRegenerate: () => void;
  onApprovalAction?: (request: ApprovalCardActionRequest) => void | Promise<void>;
  showEmptyState?: boolean;
  t: Translate;
}) {
  const dependency = `${messages.length}:${messages.at(-1)?.content.length ?? 0}:${isGenerating}`;
  const { isAtBottom, scrollRef, scrollToBottom, sentinelRef } = useFlowFitAutoScroll(dependency, messages.length);
  const lastAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id;

  return (
    <div className="relative h-full min-h-0">
      <div ref={scrollRef} className="h-full overscroll-contain overflow-y-auto scroll-smooth pb-10 pt-4">
        {messages.length ? (
          messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              isLastAssistant={message.id === lastAssistantId}
              onApprovalAction={onApprovalAction}
              onRegenerate={onRegenerate}
              t={t}
            />
          ))
        ) : showEmptyState ? (
          <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-center">
            <div>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 text-white">
                <MessageSquareText className="h-5 w-5" />
              </div>
              <h1 className="mt-5 text-2xl font-semibold tracking-normal text-slate-950">{t("chatWelcomeTitle")}</h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                {t("chatWelcomeBody")}
              </p>
            </div>
          </div>
        ) : (
          <div className="h-full min-h-[420px]" />
        )}
        <div ref={sentinelRef} className="h-1" />
      </div>
      <ScrollToBottomButton hidden={isAtBottom} label={t("scrollToBottom")} onClick={() => scrollToBottom()} />
    </div>
  );
}
