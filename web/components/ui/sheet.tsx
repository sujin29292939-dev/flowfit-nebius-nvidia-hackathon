"use client";

import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function Sheet({ open, onOpenChange, title, description, children }: SheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm">
      <div className="h-full w-full max-w-xl overflow-y-auto border-l border-border bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-6 py-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
            {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          <button
            type="button"
            className={cn(
              "rounded-lg border border-border p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950",
            )}
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
      <button className="h-full flex-1 cursor-default" onClick={() => onOpenChange(false)} />
    </div>
  );
}
