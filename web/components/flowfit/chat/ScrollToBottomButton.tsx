"use client";

import { ArrowDown } from "lucide-react";

export function ScrollToBottomButton({
  hidden,
  label,
  onClick,
}: {
  hidden: boolean;
  label: string;
  onClick: () => void;
}) {
  if (hidden) return null;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="absolute bottom-5 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-lg transition hover:border-slate-300 hover:text-slate-950"
    >
      <ArrowDown className="h-4 w-4" />
      {label}
    </button>
  );
}
