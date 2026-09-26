import { Camera, FileText, Mic, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { maskSensitiveText } from "@/services/sensitiveMasking";
import type { RawFieldIntake } from "@/types/flowfit";

const urgencyLabels: Record<RawFieldIntake["urgency"], string> = {
  normal: "보통",
  today: "오늘 처리",
  urgent: "긴급",
};

const urgencyVariants: Record<RawFieldIntake["urgency"], "default" | "warning" | "danger"> = {
  normal: "default",
  today: "warning",
  urgent: "danger",
};

function OriginalPreview({ intake }: { intake: RawFieldIntake }) {
  if (intake.imageUrls.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-100 p-4">
        <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-center">
          <div>
            <Camera className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm font-semibold text-slate-900">사진 보기</p>
            <p className="mt-1 text-xs text-slate-500">{intake.imageUrls.join(", ")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
      사진 원본 없음
    </div>
  );
}

export function RawIntakeCard({ intake }: { intake: RawFieldIntake }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={urgencyVariants[intake.urgency]}>{urgencyLabels[intake.urgency]}</Badge>
          <Badge>원본 임시 정보</Badge>
          <span className="text-xs text-slate-500">접수 {formatDateTime(intake.serverReceivedAt)}</span>
        </div>

        <OriginalPreview intake={intake} />

        <div>
          <p className="text-xs font-semibold text-slate-400">제출자</p>
          <p className="mt-1 text-sm font-semibold text-slate-950">{intake.submittedByName ?? "외부 접수 링크"}</p>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-400">짧은 메모</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-700">
            {maskSensitiveText(intake.rawText ?? "메모 없이 첨부 자료만 접수되었습니다.")}
          </p>
        </div>

        <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
          <span className="inline-flex items-center gap-1">
            <Camera className="h-3.5 w-3.5" /> 사진 {intake.imageUrls.length}
          </span>
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" /> 파일 {intake.fileUrls.length}
          </span>
          <span className="inline-flex items-center gap-1">
            <Mic className="h-3.5 w-3.5" /> 음성 {intake.voiceMemoUrl ? 1 : 0}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" />
            직원은 업로드만 가능하며 회사 데이터와 대표 승인함은 볼 수 없습니다.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
