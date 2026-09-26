import { type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn, formatNumber } from "@/lib/utils";

export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  tone = "default",
}: {
  title: string;
  value: number | string;
  description: string;
  icon: LucideIcon;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-start justify-between p-5">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-3xl font-semibold text-slate-950">
            {typeof value === "number" ? formatNumber(value) : value}
          </p>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <div
          className={cn(
            "rounded-2xl p-3",
            tone === "success" && "bg-emerald-50 text-emerald-700",
            tone === "warning" && "bg-amber-50 text-amber-700",
            tone === "danger" && "bg-rose-50 text-rose-700",
            tone === "default" && "bg-slate-100 text-slate-700",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
