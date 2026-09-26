import * as React from "react";

import { cn } from "@/lib/utils";

export interface CheckboxProps extends React.ComponentProps<"input"> {
  label?: string;
  helper?: string;
}

export function Checkbox({ className, label, helper, ...props }: CheckboxProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent p-1 transition hover:border-slate-200">
      <input
        type="checkbox"
        className={cn(
          "mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary",
          className,
        )}
        {...props}
      />
      <span className="space-y-1">
        {label ? <span className="block text-sm font-medium text-slate-900">{label}</span> : null}
        {helper ? <span className="block text-sm text-slate-500">{helper}</span> : null}
      </span>
    </label>
  );
}
