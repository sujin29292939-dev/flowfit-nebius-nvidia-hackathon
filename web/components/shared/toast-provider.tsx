"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (input: Omit<ToastItem, "id">) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const toneStyles: Record<ToastTone, string> = {
  success: "border-emerald-200 bg-emerald-50",
  error: "border-rose-200 bg-rose-50",
  info: "border-sky-200 bg-sky-50",
  warning: "border-amber-200 bg-amber-50",
};

const toneIcons = {
  success: CheckCircle2,
  error: CircleAlert,
  info: Info,
  warning: CircleAlert,
} satisfies Record<ToastTone, React.ComponentType<{ className?: string }>>;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const toast = React.useCallback((input: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setItems((current) => [...current, { id, ...input }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 3600);
  }, []);

  const remove = React.useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed right-4 top-4 z-[70] flex w-full max-w-sm flex-col gap-3">
        {items.map((item) => {
          const Icon = toneIcons[item.tone];
          return (
            <div
              key={item.id}
              className={cn(
                "rounded-2xl border p-4 shadow-panel backdrop-blur",
                toneStyles[item.tone],
              )}
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 text-slate-800" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                  {item.description ? (
                    <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="rounded-lg p-1 text-slate-500 transition hover:bg-white/70 hover:text-slate-900"
                  onClick={() => remove(item.id)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return context;
}
