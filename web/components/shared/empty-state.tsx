import { type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-10 text-center">
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
          <Icon className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-slate-950">{title}</p>
          <p className="max-w-md text-sm text-slate-500">{description}</p>
        </div>
        {actionLabel && onAction ? (
          <Button variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
