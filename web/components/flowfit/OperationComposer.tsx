"use client";

import { AudioLines, ChevronDown, Mic, Plus } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export function OperationComposer({
  onSubmit,
  placeholder = "무엇이든 물어보세요",
  disabled = false,
  className,
}: {
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [value, setValue] = React.useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <div className={cn("rounded-full bg-[#303030] px-3 py-2 text-zinc-100 shadow-xl", className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="추가"
          title="추가"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-100 transition hover:bg-white/10"
        >
          <Plus className="h-4 w-4" />
        </button>

        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              submit();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed"
        />

        <button type="button" className="hidden shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs text-zinc-100 transition hover:bg-white/10 sm:inline-flex">
          확장
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label="음성 입력" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-100 transition hover:bg-white/10">
          <Mic className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="요청 보내기"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-zinc-950 transition hover:bg-zinc-100 disabled:bg-zinc-600 disabled:text-zinc-400"
        >
          <AudioLines className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
