import { createStaffRequest } from "@/services/staffRequestStore";
import type { AiWorkItem, AiWorkStatus, StaffConfirmationRequest } from "@/types/flowfit";

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function transitionWorkStatus(work: AiWorkItem, status: AiWorkStatus): AiWorkItem {
  const now = nowIso();
  return {
    ...work,
    status,
    updatedAt: now,
    completedAt: status === "completed" || status === "auto_completed" ? now : work.completedAt,
  };
}

export function approveWork(work: AiWorkItem): AiWorkItem {
  return transitionWorkStatus(work, "completed");
}

export function approveExternalSend(work: AiWorkItem): AiWorkItem {
  return {
    ...transitionWorkStatus(work, "completed"),
    resultContent: `${work.resultContent}\n\n발송 승인되어 외부 발송 준비 목록에 등록되었습니다.`,
  };
}

export function requestWorkRevision(work: AiWorkItem, instruction: string, userName = "대표"): AiWorkItem {
  const now = nowIso();
  return {
    ...work,
    status: "revision_needed",
    updatedAt: now,
    instructionHistory: [
      ...work.instructionHistory,
      {
        id: makeId("instruction"),
        userId: "owner-demo",
        userName,
        instruction,
        createdAt: now,
      },
    ],
  };
}

export function rejectWork(work: AiWorkItem, reason: string, userName = "대표"): AiWorkItem {
  return requestWorkRevision(transitionWorkStatus(work, "cancelled"), `반려 사유: ${reason}`, userName);
}

export function regenerateWork(work: AiWorkItem, instruction?: string): AiWorkItem {
  const now = nowIso();
  return {
    ...work,
    status: "drafting",
    updatedAt: now,
    instructionHistory: instruction
      ? [
          ...work.instructionHistory,
          {
            id: makeId("instruction"),
            userId: "owner-demo",
            userName: "대표",
            instruction,
            createdAt: now,
          },
        ]
      : work.instructionHistory,
    steps: work.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? "done" : index === 1 ? "running" : "pending",
    })),
  };
}

export function createStaffConfirmationForWork(work: AiWorkItem): StaffConfirmationRequest {
  return createStaffRequest({
    aiWorkId: work.id,
    title: work.title.includes("발주") ? "A거래처 발주 접수 여부 확인" : `${work.title} 확인 요청`,
    question: work.type === "order_check" ? "A거래처 발주가 오늘 접수되었는지 확인해주세요." : `${work.title} 관련 확인이 필요합니다.`,
    internalReason: work.aiReasonSummary,
    requestedByName: work.requestedByName ?? "대표",
    staffName: "김직원",
  });
}

export function attachStaffRequest(work: AiWorkItem, request: StaffConfirmationRequest): AiWorkItem {
  return {
    ...work,
    status: "assigned_to_staff",
    assignedStaffRequestId: request.id,
    updatedAt: nowIso(),
  };
}

export function attachStaffResponseToWork(work: AiWorkItem, request: StaffConfirmationRequest): AiWorkItem {
  if (request.status !== "responded" || request.aiWorkId !== work.id) return work;

  return {
    ...work,
    status: "waiting_approval",
    updatedAt: request.respondedAt ?? nowIso(),
    aiReasonSummary: `${work.aiReasonSummary}\n직원 응답: ${request.staffName} - ${request.response}${
      request.responseMemo ? ` (${request.responseMemo})` : ""
    }`,
  };
}
