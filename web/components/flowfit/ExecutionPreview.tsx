"use client";

import { Eye, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { maskSensitiveText } from "@/services/sensitiveMasking";
import type { AiExecutionPreview } from "@/types/flowfit";

export function ExecutionPreview({ preview }: { preview?: AiExecutionPreview }) {
  if (!preview) return null;

  return (
    <Card className="border-sky-200 bg-sky-50/70 shadow-none">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-sky-700" />
              <p className="font-semibold text-slate-950">실행 미리보기</p>
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              이 화면은 AI가 처리 중인 작업의 미리보기입니다. 민감정보는 일부 가려질 수 있습니다.
            </p>
          </div>
          <Badge variant="info">대표/관리자 전용</Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-3">
            <p className="text-xs font-semibold text-slate-400">외부 서비스</p>
            <p className="mt-1 font-medium text-slate-900">{preview.serviceName ?? "확인 중"}</p>
          </div>
          <div className="rounded-2xl bg-white p-3">
            <p className="text-xs font-semibold text-slate-400">확인 중인 화면</p>
            <p className="mt-1 font-medium text-slate-900">{preview.screenName ?? "확인 중"}</p>
          </div>
        </div>

        {preview.safeActionSummary?.length ? (
          <div>
            <p className="text-xs font-semibold text-slate-500">최근 실행한 안전한 액션 요약</p>
            <ul className="mt-2 space-y-2">
              {preview.safeActionSummary.map((item) => (
                <li key={item} className="rounded-2xl bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                  {maskSensitiveText(item)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="rounded-2xl border border-dashed border-sky-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            마스킹된 스크린샷 미리보기 영역
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            현재 버전에서는 실제 화면 캡처를 저장하지 않고, 서비스명과 안전한 액션 요약만 보여줍니다.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
