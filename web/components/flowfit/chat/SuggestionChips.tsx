"use client";

import { FileText, PackageCheck, Sparkles, Truck } from "lucide-react";

import type { FlowFitMessageKey } from "@/hooks/useFlowFitChatI18n";

type Translate = (key: FlowFitMessageKey, params?: Record<string, string | number>) => string;

const suggestions = [
  {
    id: "hello",
    labelKey: "suggestHello",
    promptKey: "suggestHelloPrompt",
    icon: Sparkles,
  },
  {
    id: "quote",
    labelKey: "suggestQuote",
    promptKey: "suggestQuotePrompt",
    icon: FileText,
  },
  {
    id: "order",
    labelKey: "suggestOrder",
    promptKey: "suggestOrderPrompt",
    icon: PackageCheck,
  },
  {
    id: "delivery",
    labelKey: "suggestDelivery",
    promptKey: "suggestDeliveryPrompt",
    icon: Truck,
  },
] satisfies Array<{ id: string; labelKey: FlowFitMessageKey; promptKey: FlowFitMessageKey; icon: typeof Sparkles }>;

export function SuggestionChips({
  disabled,
  onSelect,
  t,
}: {
  disabled: boolean;
  onSelect: (prompt: string) => void;
  t: Translate;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {suggestions.map((item) => {
        const Icon = item.icon;

        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(t(item.promptKey))}
            className="flex min-h-14 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <Icon className="h-4 w-4" />
            </span>
            {t(item.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
