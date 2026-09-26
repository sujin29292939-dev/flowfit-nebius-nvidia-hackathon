import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-[420px]" />
      </div>
    </div>
  );
}
