"use client";

import * as React from "react";

import type {
  OperationChatAttachment,
  OperationChatMessage,
  OperationChatSession,
} from "@/services/operationChatFileStore";
import type { ApprovalCardActionRequest } from "@/components/flowfit/chat/ApprovalCard";
import type { FlowFitMessageKey } from "@/hooks/useFlowFitChatI18n";
import type { FlowFitLocale } from "@/hooks/useFlowFitChatI18n";

type Translate = (key: FlowFitMessageKey, params?: Record<string, string | number>) => string;

export type FlowFitChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  attachments?: OperationChatAttachment[];
  thinking?: string;
  isStreaming: boolean;
  isComplete: boolean;
};

type StreamEvent = {
  event: string;
  data: unknown;
};

function makeClientId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mapMessage(message: OperationChatMessage): FlowFitChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    attachments: message.attachments,
    createdAt: message.createdAt,
    isComplete: true,
    isStreaming: false,
  };
}

function parseSseBlock(block: string): StreamEvent | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!dataLines.length) return null;

  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return { event, data: dataLines.join("\n") };
  }
}

function getPayloadText(data: unknown) {
  return data && typeof data === "object" && "text" in data ? String((data as { text?: unknown }).text ?? "") : "";
}

function getPayloadMessage(data: unknown) {
  return data && typeof data === "object" && "message" in data
    ? String((data as { message?: unknown }).message ?? "")
    : "stream failed";
}

async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const parsed = parseSseBlock(block.trim());
      if (parsed) onEvent(parsed);
    }
  }

  buffer += decoder.decode();
  const trailing = parseSseBlock(buffer.trim());
  if (trailing) onEvent(trailing);
}

export function useFlowFitStreamingChat({
  session,
  onSessionUpdate,
  locale,
  t,
}: {
  session: OperationChatSession | null;
  onSessionUpdate: (session: OperationChatSession) => void;
  locale: FlowFitLocale;
  t: Translate;
}) {
  const [messages, setMessages] = React.useState<FlowFitChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const sessionIdRef = React.useRef<string | null>(session?.id ?? null);
  const lastPromptRef = React.useRef<string>("");

  React.useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
    if (!isGenerating) {
      setMessages(session?.messages.map(mapMessage) ?? []);
    }
  }, [isGenerating, session?.id, session?.messages, session?.updatedAt]);

  const markAssistant = React.useCallback((assistantId: string, patch: Partial<FlowFitChatMessage>) => {
    setMessages((current) =>
      current.map((message) => (message.id === assistantId ? { ...message, ...patch } : message)),
    );
  }, []);

  const appendAssistantText = React.useCallback((assistantId: string, text: string) => {
    if (!text) return;
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId ? { ...message, content: `${message.content}${text}` } : message,
      ),
    );
  }, []);

  const appendThinkingText = React.useCallback((assistantId: string, text: string) => {
    if (!text) return;
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId ? { ...message, thinking: `${message.thinking ?? ""}${text}` } : message,
      ),
    );
  }, []);

  const startStream = React.useCallback(
    async ({
      message,
      regenerate = false,
      appendUser = true,
      attachments = [],
    }: {
      message: string;
      regenerate?: boolean;
      appendUser?: boolean;
      attachments?: OperationChatAttachment[];
    }) => {
      const trimmed = message.trim();
      if ((!trimmed && !regenerate) || isGenerating) return;

      if (trimmed.length > 32_000) {
        setError(t("inputTooLong"));
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const assistantId = makeClientId("assistant");
      lastPromptRef.current = trimmed;
      setError(null);
      setIsGenerating(true);

      setMessages((current) => {
        const assistantMessage: FlowFitChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
          thinking: "",
          isComplete: false,
          isStreaming: true,
        };

        if (!appendUser) {
          return [...current, assistantMessage];
        }

        return [
          ...current,
          {
            id: makeClientId("user"),
            role: "user",
            content: trimmed,
            attachments,
            isComplete: true,
            isStreaming: false,
          },
          assistantMessage,
        ];
      });

      try {
        const response = await fetch("/api/operation-chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            regenerate,
            locale,
            sessionId: sessionIdRef.current,
            attachments,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`network ${response.status}`);
        }

        await readSseStream(response.body, ({ event, data }) => {
          if (event === "thinking_delta") {
            appendThinkingText(assistantId, getPayloadText(data));
            return;
          }

          if (event === "delta") {
            appendAssistantText(assistantId, getPayloadText(data));
            return;
          }

          if (event === "session") {
            const nextSession = (data as { session?: OperationChatSession }).session;
            if (nextSession) {
              sessionIdRef.current = nextSession.id;
              onSessionUpdate(nextSession);
            }
            return;
          }

          if (event === "error") {
            throw new Error(getPayloadMessage(data));
          }
        });

        markAssistant(assistantId, { isComplete: true, isStreaming: false });
      } catch (caught) {
        if (controller.signal.aborted) {
          appendAssistantText(assistantId, `\n\n${t("stopped")}`);
          markAssistant(assistantId, { isComplete: true, isStreaming: false });
        } else {
          const messageText = caught instanceof Error ? caught.message : String(caught);
          setError(t("networkError", { message: messageText }));
          markAssistant(assistantId, {
            content: t("failedResponse"),
            isComplete: true,
            isStreaming: false,
          });
        }
      } finally {
        abortRef.current = null;
        setIsGenerating(false);
      }
    },
    [appendAssistantText, appendThinkingText, isGenerating, locale, markAssistant, onSessionUpdate, t],
  );

  const send = React.useCallback(
    (message: string, attachments?: OperationChatAttachment[]) => startStream({ message, attachments }),
    [startStream],
  );

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const regenerate = React.useCallback(() => {
    if (isGenerating) return;

    const lastAssistantIndex = [...messages].map((message) => message.role).lastIndexOf("assistant");
    if (lastAssistantIndex < 0) return;

    const previousUser = [...messages.slice(0, lastAssistantIndex)].reverse().find((message) => message.role === "user");
    if (!previousUser) return;

    setMessages((current) => current.filter((_, index) => index !== lastAssistantIndex));
    void startStream({
      message: previousUser.content,
      regenerate: Boolean(sessionIdRef.current),
      appendUser: false,
    });
  }, [isGenerating, messages, startStream]);

  const retry = React.useCallback(() => {
    const prompt = lastPromptRef.current;
    if (prompt) {
      setError(null);
      void startStream({ message: prompt });
    }
  }, [startStream]);

  const runApprovalAction = React.useCallback(
    async (request: ApprovalCardActionRequest) => {
      if (!sessionIdRef.current) {
        setError(t("failedResponse"));
        return;
      }

      setError(null);

      try {
        const response = await fetch("/api/operation-chat/approval-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: request.action,
            approvalId: request.approvalId,
            label: request.label,
            payload: request.payload,
            sessionId: sessionIdRef.current,
          }),
        });
        const payload = (await response.json().catch(() => null)) as { session?: OperationChatSession; error?: string } | null;

        if (!response.ok || !payload?.session) {
          throw new Error(payload?.error ?? `approval_card_http_${response.status}`);
        }

        sessionIdRef.current = payload.session.id;
        setMessages(payload.session.messages.map(mapMessage));
        onSessionUpdate(payload.session);
      } catch (caught) {
        const messageText = caught instanceof Error ? caught.message : String(caught);
        setError(t("networkError", { message: messageText }));
      }
    },
    [onSessionUpdate, t],
  );

  return {
    error,
    isGenerating,
    messages,
    regenerate,
    retry,
    runApprovalAction,
    send,
    setMessages,
    stop,
  };
}
