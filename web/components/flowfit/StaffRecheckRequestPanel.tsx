"use client";

import { MessageSquareReply } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateStaffRequest } from "@/services/staffRequestStore";
import type { StaffConfirmationRequest } from "@/types/flowfit";

export function StaffRecheckRequestPanel({
  request,
  onRespond,
}: {
  request?: StaffConfirmationRequest;
  onRespond: (response: string) => void;
}) {
  if (!request) return null;

  const responded = request.status === "responded";

  return (
    <div className="rounded-3xl border border-sky-200 bg-sky-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={responded ? "success" : "info"}>{responded ? "직원 응답 회수" : "직원 재확인 요청"}</Badge>
        <span className="text-xs text-sky-700">MockConnector</span>
      </div>

      <div className="mt-3 rounded-2xl bg-white p-3">
        <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{request.messagePreview}</p>
      </div>

      {responded ? (
        <p className="mt-3 text-sm font-semibold text-sky-950">
          {request.staffName}: {request.response}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {request.responseOptions.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                updateStaffRequest(request.id, (item) => ({
                  ...item,
                  status: "responded",
                  response: option,
                  responseMemo: "MockConnector에서 테스트 응답으로 회수했습니다.",
                  respondedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }));
                onRespond(option);
              }}
            >
              <MessageSquareReply className="h-4 w-4" />
              {option}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
