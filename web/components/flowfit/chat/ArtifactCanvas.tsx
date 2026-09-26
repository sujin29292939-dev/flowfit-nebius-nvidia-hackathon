"use client";

import { Code2, Eye, X } from "lucide-react";
import * as React from "react";

import type { FlowFitArtifact } from "@/components/flowfit/chat/artifact-utils";
import type { FlowFitMessageKey } from "@/hooks/useFlowFitChatI18n";
import { cn } from "@/lib/utils";

type Translate = (key: FlowFitMessageKey, params?: Record<string, string | number>) => string;

export function ArtifactCanvas({
  artifact,
  onClose,
  t,
}: {
  artifact: FlowFitArtifact | null;
  onClose: () => void;
  t: Translate;
}) {
  const [tab, setTab] = React.useState<"preview" | "source">("preview");

  React.useEffect(() => {
    setTab("preview");
  }, [artifact?.code]);

  if (!artifact) {
    return (
      <aside className="hidden h-full min-h-0 border-l border-slate-200 bg-slate-50 p-4 xl:block">
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          {t("artifactEmpty")}
        </div>
      </aside>
    );
  }

  const canPreview = artifact.type === "html";

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-slate-200 bg-slate-50">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">{t("artifact")}: {artifact.title}</p>
          <p className="text-xs text-slate-500">
            {artifact.lineCount.toLocaleString()} {t("lines")}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("artifactClose")}
          title={t("artifactClose")}
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-slate-200 bg-white px-3 py-2">
        <button
          type="button"
          disabled={!canPreview}
          onClick={() => setTab("preview")}
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold transition",
            tab === "preview" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
            !canPreview && "cursor-not-allowed opacity-50",
          )}
        >
          <Eye className="h-3.5 w-3.5" />
          {t("artifactPreview")}
        </button>
        <button
          type="button"
          onClick={() => setTab("source")}
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold transition",
            tab === "source" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
          )}
        >
          <Code2 className="h-3.5 w-3.5" />
          {t("artifactSource")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {tab === "preview" && canPreview ? (
          <iframe
            title={t("artifact")}
            sandbox="allow-scripts"
            srcDoc={artifact.code}
            className="h-full w-full rounded-lg border border-slate-200 bg-white"
          />
        ) : (
          <pre className="h-full overflow-auto rounded-lg bg-zinc-950 p-4 text-xs leading-5 text-zinc-100">
            <code>{artifact.code}</code>
          </pre>
        )}
      </div>
    </aside>
  );
}
