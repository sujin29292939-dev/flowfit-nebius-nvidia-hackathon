"use client";

import { Code2, Eye, RefreshCw } from "lucide-react";
import * as React from "react";

import { ApprovalCard, parseApprovalCardContent } from "@/components/flowfit/chat/ApprovalCard";
import { MarkdownRenderer } from "@/components/flowfit/chat/MarkdownRenderer";
import { StructuredAiMessage, parseStructuredAiMessage } from "@/components/flowfit/chat/StructuredAiMessage";
import { ToolUseCard, extractToolUseBlocks } from "@/components/flowfit/chat/ToolUseCard";
import { extractArtifact, type FlowFitArtifact } from "@/components/flowfit/chat/artifact-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFlowFitChatI18n } from "@/hooks/useFlowFitChatI18n";
import { cn } from "@/lib/utils";
import type { OperationChatMessage, OperationChatSession } from "@/services/operationChatFileStore";

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 정보 없음";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function HistoryArtifactPreview({ artifact }: { artifact: FlowFitArtifact }) {
  const [showSource, setShowSource] = React.useState(false);
  const canPreview = artifact.type === "html";

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">UI 미리보기</p>
          <p className="text-xs text-slate-500">{artifact.lineCount.toLocaleString()}줄 · {artifact.title}</p>
        </div>
        <button
          type="button"
          disabled={!canPreview}
          onClick={() => setShowSource((current) => !current)}
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition",
            showSource ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300",
            !canPreview && "cursor-not-allowed opacity-50",
          )}
        >
          {showSource ? <Code2 className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showSource ? "코드" : "화면"}
        </button>
      </div>
      <div className="h-[420px] bg-slate-50 p-3">
        {showSource || !canPreview ? (
          <pre className="h-full overflow-auto rounded-xl bg-zinc-950 p-4 text-xs leading-5 text-zinc-100">
            <code>{artifact.code}</code>
          </pre>
        ) : (
          <iframe
            title="UI 미리보기"
            sandbox="allow-scripts"
            srcDoc={artifact.code}
            className="h-full w-full rounded-xl border border-slate-200 bg-white"
          />
        )}
      </div>
    </section>
  );
}

function HistoryMessageBubble({
  message,
  t,
}: {
  message: OperationChatMessage;
  t: ReturnType<typeof useFlowFitChatI18n>["t"];
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-3xl bg-slate-950 px-4 py-3 text-sm leading-6 text-white">
          <p className="whitespace-pre-wrap text-white">{message.content}</p>
        </div>
      </div>
    );
  }

  const toolUse = extractToolUseBlocks(message.content);
  const content = toolUse.cleaned || message.content;
  const structuredMessage = parseStructuredAiMessage(content);
  const approvalCard = structuredMessage ? null : parseApprovalCardContent(content);
  const artifact = structuredMessage || approvalCard ? null : extractArtifact(content);

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800">
        {toolUse.blocks.map((block) => <ToolUseCard key={block.id} block={block} t={t} />)}
        {structuredMessage ? (
          <StructuredAiMessage message={structuredMessage} />
        ) : approvalCard ? (
          <ApprovalCard payload={approvalCard} />
        ) : artifact?.type === "html" ? (
          <HistoryArtifactPreview artifact={artifact} />
        ) : (
          <MarkdownRenderer content={content} />
        )}
      </div>
    </div>
  );
}

export function OperationChatHistory() {
  const { t } = useFlowFitChatI18n();
  const [sessions, setSessions] = React.useState<OperationChatSession[]>([]);
  const [loading, setLoading] = React.useState(true);

  async function loadSessions() {
    setLoading(true);
    try {
      const response = await fetch("/api/operation-chat", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { sessions?: OperationChatSession[] };
      setSessions(payload.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadSessions();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal text-slate-950">채팅 기록</h1>
          <p className="mt-2 text-sm text-slate-500">AI 운영 요청실에서 나눈 대화가 컴퓨터 내부 파일에 저장됩니다.</p>
        </div>
        <Button type="button" variant="outline" className="rounded-xl" onClick={loadSessions} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          새로고침
        </Button>
      </div>

      {sessions.length ? (
        <div className="space-y-4">
          {sessions.map((session) => (
            <Card key={session.id}>
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-semibold text-slate-950">{session.title}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(session.updatedAt)}</p>
                </div>
                <div className="space-y-3">
                  {session.messages.map((message) => (
                    <HistoryMessageBubble key={message.id} message={message} t={t} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="font-semibold text-slate-950">저장된 채팅 기록이 없습니다</p>
            <p className="mt-2 text-sm text-slate-500">AI 운영 요청실에서 대화를 시작하면 이곳에 표시됩니다.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
