"use client";

import { MessageSquareText, Send, ShieldAlert, UserRoundCheck } from "lucide-react";
import * as React from "react";

import { FlowFitRoleControl, RestrictedEmployeeView, canUseAiOperations, useFlowFitRole } from "@/components/flowfit/flowfit-access";
import { staffRequestStatusLabels } from "@/components/flowfit/flowfit-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatDateTime } from "@/lib/utils";
import { attachStaffResponseToWork } from "@/services/aiWorkEngine";
import { getAiWorkItems, saveAiWorkItems } from "@/services/aiWorkStore";
import { mockConnector } from "@/services/companyMessengerConnectors";
import { maskPhone } from "@/services/sensitiveMasking";
import { getStaffRequests, saveStaffRequests } from "@/services/staffRequestStore";
import type { StaffConfirmationRequest } from "@/types/flowfit";

function statusVariant(status: StaffConfirmationRequest["status"]): "default" | "success" | "warning" | "danger" | "info" {
  if (status === "responded") return "success";
  if (status === "sent") return "info";
  if (status === "waiting_approval" || status === "draft") return "warning";
  if (status === "cancelled" || status === "expired") return "danger";
  return "default";
}

export function StaffConfirmationPanel() {
  const { role, setRole } = useFlowFitRole();
  const [requests, setRequests] = React.useState<StaffConfirmationRequest[]>([]);

  React.useEffect(() => {
    setRequests(getStaffRequests());
  }, []);

  if (!canUseAiOperations(role)) {
    return (
      <div className="space-y-4">
        <FlowFitRoleControl role={role} onChange={setRole} />
        <RestrictedEmployeeView />
      </div>
    );
  }

  function commit(nextRequests: StaffConfirmationRequest[]) {
    setRequests(nextRequests);
    saveStaffRequests(nextRequests);
  }

  async function sendRequest(request: StaffConfirmationRequest) {
    const result = await mockConnector.sendStaffRequest(request);
    commit(
      requests.map((item) =>
        item.id === request.id
          ? {
              ...item,
              status: "sent",
              externalMessageId: result.externalMessageId,
              sentAt: result.sentAt,
              updatedAt: result.sentAt,
            }
          : item,
      ),
    );
  }

  async function respond(request: StaffConfirmationRequest, response: string) {
    const result = await mockConnector.receiveStaffResponse({
      requestId: request.id,
      response,
      responseMemo: response === "확인 중" ? "담당자가 추가 확인 후 다시 응답 예정" : undefined,
    });
    const nextRequests = requests.map((item) =>
      item.id === request.id
        ? {
            ...item,
            status: "responded" as const,
            response: result.response,
            responseMemo: result.responseMemo,
            respondedAt: result.respondedAt,
            updatedAt: result.respondedAt,
          }
        : item,
    );
    commit(nextRequests);

    const updatedRequest = nextRequests.find((item) => item.id === request.id);
    if (updatedRequest) {
      const nextWorks = getAiWorkItems().map((work) => attachStaffResponseToWork(work, updatedRequest));
      saveAiWorkItems(nextWorks);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="muted-caption">직원 확인 요청</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">직원은 외부 채널로 필요한 질문만 받습니다</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            직원에게는 사장-AI 대화, 내부 위험도, 전체 작업 기록을 보여주지 않습니다. 승인된 짧은 확인 요청만 회사 메신저나 문자로 보냅니다.
          </p>
        </div>
        <FlowFitRoleControl role={role} onChange={setRole} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="발송 대기" value={requests.filter((item) => item.status === "waiting_approval").length} />
        <SummaryCard label="발송됨" value={requests.filter((item) => item.status === "sent").length} />
        <SummaryCard label="응답 완료" value={requests.filter((item) => item.status === "responded").length} />
      </div>

      <div className="space-y-4">
        {requests.map((request) => (
          <article key={request.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(request.status)}>{staffRequestStatusLabels[request.status]}</Badge>
                  <Badge variant="info">MockConnector</Badge>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500">
                    {request.staffName} · {request.staffContact ? maskPhone(request.staffContact) : "연락처 없음"}
                  </span>
                </div>
                <h2 className="mt-3 text-xl font-semibold text-slate-950">{request.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{request.question}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm lg:w-[20rem]">
                <p className="text-xs font-semibold text-slate-400">발송 정보</p>
                <p className="mt-1 text-slate-700">요청자: {request.requestedByName}</p>
                <p className="mt-1 text-slate-700">채널: MockConnector</p>
                <p className="mt-1 text-slate-500">업데이트 {formatDateTime(request.updatedAt)}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <MessageSquareText className="h-4 w-4" />
                  직원에게 보이는 문구
                </div>
                <p className="mt-3 whitespace-pre-line text-sm leading-6 text-emerald-950">{request.messagePreview}</p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                  <ShieldAlert className="h-4 w-4" />
                  내부 판단 이유
                </div>
                <p className="mt-3 text-sm leading-6 text-amber-950">
                  이 내용은 직원에게 보내지 않습니다. {request.internalReason}
                </p>
              </div>
            </div>

            {request.response ? (
              <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <p className="text-xs font-semibold text-sky-700">회수된 응답</p>
                <p className="mt-2 text-sm font-semibold text-sky-950">
                  {request.response}
                  {request.responseMemo ? ` · ${request.responseMemo}` : ""}
                </p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {request.status === "waiting_approval" || request.status === "draft" ? (
                <Button type="button" size="sm" onClick={() => sendRequest(request)}>
                  <Send className="h-4 w-4" />
                  Mock 발송
                </Button>
              ) : null}
              {request.status === "sent" ? (
                request.responseOptions.map((option) => (
                  <Button key={option} type="button" variant="outline" size="sm" onClick={() => respond(request, option)}>
                    <UserRoundCheck className="h-4 w-4" />
                    {option}
                  </Button>
                ))
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-slate-500">{label}</p>
        <p className={cn("mt-2 text-2xl font-semibold text-slate-950")}>{value}</p>
      </CardContent>
    </Card>
  );
}

