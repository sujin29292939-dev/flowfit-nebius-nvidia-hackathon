"use client";

import { Brain, ChevronDown } from "lucide-react";
import * as React from "react";

import type { FlowFitMessageKey } from "@/hooks/useFlowFitChatI18n";
import { cn } from "@/lib/utils";

type Translate = (key: FlowFitMessageKey, params?: Record<string, string | number>) => string;

export function ThinkingPanel({
  content,
  isStreaming,
  t,
}: {
  content?: string;
  isStreaming: boolean;
  t: Translate;
}) {
  const [expanded, setExpanded] = React.useState(isStreaming);

  React.useEffect(() => {
    setExpanded(isStreaming);
  }, [isStreaming]);

  if (!content && !isStreaming) return null;

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-slate-600"
      >
        <span className="inline-flex items-center gap-2">
          <Brain className="h-3.5 w-3.5" />
          {isStreaming ? t("thinkingActive") : t("thinkingView")}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition", expanded && "rotate-180")} />
      </button>
      {expanded ? (
        <div className="border-t border-slate-200 px-3 py-2 text-xs leading-5 text-slate-500">
          <pre className="whitespace-pre-wrap font-sans">{content || t("thinkingPlaceholder")}</pre>
        </div>
      ) : null}
    </div>
  );
}
