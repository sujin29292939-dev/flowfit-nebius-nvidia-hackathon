"use client";

import { ChevronDown, Wrench } from "lucide-react";
import * as React from "react";

import type { FlowFitMessageKey } from "@/hooks/useFlowFitChatI18n";
import { cn } from "@/lib/utils";

type Translate = (key: FlowFitMessageKey, params?: Record<string, string | number>) => string;

export type ToolUseBlock = {
  body: string;
  id: string;
  name: string;
  parsed?: Record<string, unknown>;
};

const fencedToolPattern = /```tool_use\s*\n([\s\S]*?)```/gi;
const xmlToolPattern = /<tool_use>([\s\S]*?)<\/tool_use>/gi;

function tryParseJson(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function makeToolBlock(body: string, index: number): ToolUseBlock {
  const parsed = tryParseJson(body.trim());
  const name =
    typeof parsed?.name === "string"
      ? parsed.name
      : typeof parsed?.tool === "string"
        ? parsed.tool
        : typeof parsed?.tool_name === "string"
          ? parsed.tool_name
          : `tool_use_${index + 1}`;

  return {
    body: body.trim(),
    id: `${name}-${index}`,
    name,
    parsed,
  };
}

export function extractToolUseBlocks(content: string) {
  const blocks: ToolUseBlock[] = [];
  let cleaned = content;
  let match: RegExpExecArray | null;

  while ((match = fencedToolPattern.exec(content))) {
    blocks.push(makeToolBlock(match[1], blocks.length));
    cleaned = cleaned.replace(match[0], "");
  }

  while ((match = xmlToolPattern.exec(content))) {
    blocks.push(makeToolBlock(match[1], blocks.length));
    cleaned = cleaned.replace(match[0], "");
  }

  return {
    blocks,
    cleaned: cleaned.trim(),
  };
}

function stringifyValue(value: unknown) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function ToolUseCard({ block, t }: { block: ToolUseBlock; t: Translate }) {
  const [expanded, setExpanded] = React.useState(false);
  const input = stringifyValue(block.parsed?.input ?? block.parsed?.arguments ?? block.parsed?.params);
  const output = stringifyValue(block.parsed?.output ?? block.parsed?.result);

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white">
            <Wrench className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-slate-950">{t("toolUse")}</span>
            <span className="block truncate text-xs text-slate-500">{block.name}</span>
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition", expanded && "rotate-180")} />
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-slate-200 px-3 py-3">
          {input ? (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-500">{t("toolInput")}</p>
              <pre className="max-h-48 overflow-auto rounded-md bg-slate-50 p-2 text-xs leading-5 text-slate-700">{input}</pre>
            </div>
          ) : null}
          {output ? (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-500">{t("toolOutput")}</p>
              <pre className="max-h-48 overflow-auto rounded-md bg-slate-50 p-2 text-xs leading-5 text-slate-700">{output}</pre>
            </div>
          ) : null}
          {!input && !output ? (
            <pre className="max-h-64 overflow-auto rounded-md bg-slate-50 p-2 text-xs leading-5 text-slate-700">{block.body}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
