"use client";

import { CheckCircle2, PauseCircle, RotateCcw, Send, XCircle } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function OwnerReviewActions({
  disabled,
  missingFields,
  onAccept,
  onAcceptWithCorrection,
  onRecheck,
  onReject,
  onHold,
}: {
  disabled?: boolean;
  missingFields: string[];
  onAccept: () => void;
  onAcceptWithCorrection: (correction: Record<string, string>) => void;
  onRecheck: (question?: string) => void;
  onReject: () => void;
  onHold: () => void;
}) {
  const [correctionOpen, setCorrectionOpen] = React.useState(false);
  const [correctionField, setCorrectionField] = React.useState(missingFields[0] ?? "대표 수정");
  const [correctionValue, setCorrectionValue] = React.useState("");
  const [recheckOpen, setRecheckOpen] = React.useState(false);
  const [question, setQuestion] = React.useState(
    missingFields[0] ? `${missingFields[0]} 정보를 확인해주세요.` : "방금 접수한 건의 부족 정보를 확인해주세요.",
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onAccept} disabled={disabled}>
          <CheckCircle2 className="h-4 w-4" />
          공식 정보로 수락
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setCorrectionOpen((current) => !current)} disabled={disabled}>
          <RotateCcw className="h-4 w-4" />
          수정 후 수락
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setRecheckOpen((current) => !current)} disabled={disabled}>
          <Send className="h-4 w-4" />
          직원에게 재확인
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onReject} disabled={disabled}>
          <XCircle className="h-4 w-4" />
          반려
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onHold} disabled={disabled}>
          <PauseCircle className="h-4 w-4" />
          보류
        </Button>
      </div>

      {correctionOpen ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
            <Input value={correctionField} onChange={(event) => setCorrectionField(event.target.value)} placeholder="수정 항목" />
            <Input value={correctionValue} onChange={(event) => setCorrectionValue(event.target.value)} placeholder="대표가 확인한 값" />
            <Button
              type="button"
              onClick={() => {
                if (!correctionField.trim() || !correctionValue.trim()) return;
                onAcceptWithCorrection({ [correctionField.trim()]: correctionValue.trim() });
                setCorrectionValue("");
              }}
              disabled={!correctionField.trim() || !correctionValue.trim()}
            >
              수정 반영
            </Button>
          </div>
        </div>
      ) : null}

      {recheckOpen ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="직원에게 보낼 확인 질문"
            className="min-h-[72px]"
          />
          <div className="mt-2 flex justify-end">
            <Button type="button" size="sm" onClick={() => onRecheck(question)} disabled={!question.trim()}>
              재확인 요청 만들기
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
