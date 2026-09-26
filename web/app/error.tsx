"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function getErrorDetails(error: Error & { digest?: string }) {
  return [
    ["name", error.name || "Error"],
    ["message", error.message || "unknown"],
    ["digest", error.digest || "none"],
    ["cause", error.cause ? String(error.cause) : "none"],
    ["stack", error.stack || "none"],
  ];
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>운영 UI를 불러오는 중 문제가 발생했습니다</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-6 text-slate-600">
            일시적인 렌더링 오류일 수 있습니다. 다시 시도해도 계속 재현되면 현재 화면 경로와 함께 관리자에게 전달하세요.
          </p>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">오류 코드</p>
            <div className="mt-3 space-y-2">
              {getErrorDetails(error).map(([label, value]) => (
                <div key={label} className="rounded-xl bg-white p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">{value}</pre>
                </div>
              ))}
            </div>
          </div>
          <Button onClick={reset}>다시 시도</Button>
        </CardContent>
      </Card>
    </div>
  );
}
