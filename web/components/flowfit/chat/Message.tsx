"use client";

import { Check, Copy, FileText, Image, RefreshCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import * as React from "react";

import { ApprovalCard, type ApprovalCardActionRequest, parseApprovalCardContent } from "@/components/flowfit/chat/ApprovalCard";
import { MarkdownRenderer } from "@/components/flowfit/chat/MarkdownRenderer";
import { StructuredAiMessage, parseStructuredAiMessage } from "@/components/flowfit/chat/StructuredAiMessage";
import { ThinkingPanel } from "@/components/flowfit/chat/ThinkingPanel";
import { ToolUseCard, extractToolUseBlocks } from "@/components/flowfit/chat/ToolUseCard";
import type { FlowFitMessageKey } from "@/hooks/useFlowFitChatI18n";
import type { FlowFitChatMessage } from "@/hooks/useFlowFitStreamingChat";
import { cn } from "@/lib/utils";

type Translate = (key: FlowFitMessageKey, params?: Record<string, string | number>) => string;

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function MessageActionButton({
  active,
  children,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-950",
        active && "bg-slate-100 text-slate-950",
      )}
    >
      {children}
    </button>
  );
}

function MessageView({
  message,
  isLastAssistant,
  onRegenerate,
  onApprovalAction,
  t,
}: {
  message: FlowFitChatMessage;
  isLastAssistant: boolean;
  onRegenerate: () => void;
  onApprovalAction?: (request: ApprovalCardActionRequest) => void | Promise<void>;
  t: Translate;
}) {
  const [copied, setCopied] = React.useState(false);
  const [feedback, setFeedback] = React.useState<"up" | "down" | null>(null);
  const isAssistant = message.role === "assistant";
  const toolUse = React.useMemo(() => extractToolUseBlocks(message.content), [message.content]);
  const approvalCard = React.useMemo(
    () => (isAssistant && message.isComplete ? parseApprovalCardContent(toolUse.cleaned || message.content) : null),
    [isAssistant, message.content, message.isComplete, toolUse.cleaned],
  );
  const structuredMessage = React.useMemo(
    () => (isAssistant && message.isComplete ? parseStructuredAiMessage(toolUse.cleaned || message.content) : null),
    [isAssistant, message.content, message.isComplete, toolUse.cleaned],
  );
  const visibleContent = approvalCard || structuredMessage ? "" : toolUse.cleaned || (message.isComplete ? t("emptyResponse") : "");

  async function handleCopy() {
    await copyText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  if (!isAssistant) {
    return (
      <article className="flex justify-end px-4 py-2 sm:px-8">
        <div className="max-w-[82%] rounded-lg bg-slate-950 px-4 py-3 text-sm leading-6 text-white shadow-sm sm:max-w-[72%]">
          <p className="whitespace-pre-wrap text-white">{message.content}</p>
          {message.attachments?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {message.attachments.map((attachment) => {
                const Icon = attachment.mimeType.startsWith("image/") ? Image : FileText;

                return (
                  <span
                    key={attachment.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-xs text-white/85"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="max-w-[10rem] truncate">{attachment.name}</span>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article className="group px-4 py-4 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <ThinkingPanel content={message.thinking} isStreaming={message.isStreaming} t={t} />
        {message.isComplete
          ? toolUse.blocks.map((block) => <ToolUseCard key={block.id} block={block} t={t} />)
          : null}
        {structuredMessage ? (
          <StructuredAiMessage message={structuredMessage} onAction={onApprovalAction} />
        ) : approvalCard ? (
          <ApprovalCard payload={approvalCard} onAction={onApprovalAction} />
        ) : (
          <div
            className={cn(
              "text-sm leading-7 text-slate-800",
              message.isStreaming && "flowfit-streaming-cursor whitespace-pre-wrap",
            )}
          >
            {message.isComplete ? <MarkdownRenderer content={visibleContent} /> : visibleContent}
          </div>
        )}
        <div className="mt-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <MessageActionButton label={copied ? t("copied") : t("copy")} onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </MessageActionButton>
          <MessageActionButton
            label={t("like")}
            active={feedback === "up"}
            onClick={() => setFeedback((current) => (current === "up" ? null : "up"))}
          >
            <ThumbsUp className="h-4 w-4" />
          </MessageActionButton>
          <MessageActionButton
            label={t("dislike")}
            active={feedback === "down"}
            onClick={() => setFeedback((current) => (current === "down" ? null : "down"))}
          >
            <ThumbsDown className="h-4 w-4" />
          </MessageActionButton>
          {isLastAssistant ? (
            <MessageActionButton label={t("regenerate")} onClick={onRegenerate}>
              <RefreshCcw className="h-4 w-4" />
            </MessageActionButton>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export const Message = React.memo(MessageView);
