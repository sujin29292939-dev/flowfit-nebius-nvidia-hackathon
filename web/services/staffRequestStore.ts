import type { StaffConfirmationRequest } from "@/types/flowfit";

const STAFF_REQUEST_STORAGE_KEY = "flowfit-staff-confirmation-requests";

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const initialStaffRequests: StaffConfirmationRequest[] = [
  {
    id: "staff-request-order-a",
    companyId: "flowfit-demo",
    aiWorkId: "ai-work-order-missing-approval",
    requestedByUserId: "owner-demo",
    requestedByName: "대표",
    staffId: "staff-kim",
    staffName: "김직원",
    staffContact: "010-1234-5678",
    channel: "manual",
    status: "sent",
    title: "A거래처 발주 접수 여부 확인",
    question: "A거래처 발주가 오늘 접수되었는지 확인해주세요.",
    responseOptions: ["접수됨", "미접수", "확인 중"],
    messagePreview:
      "[FlowFit 확인 요청 · 사장 요청]\n\nA거래처 발주 접수 여부 확인\n\n확인할 내용:\nA거래처 발주가 오늘 접수되었는지 확인해주세요.\n\n응답:\n[접수됨] [미접수] [확인 중]",
    internalReason: "발주 누락 가능성이 있어 담당 직원 확인이 필요함. 직원에게는 내부 위험도와 AI 판단 전체를 노출하지 않습니다.",
    sentAt: "2026-04-28T16:50:00+09:00",
    externalMessageId: "mock-staff-request-order-a",
    createdAt: "2026-04-28T16:45:00+09:00",
    updatedAt: "2026-04-28T16:50:00+09:00",
  },
];

function readRequests() {
  if (typeof window === "undefined") return initialStaffRequests;

  try {
    const raw = window.localStorage.getItem(STAFF_REQUEST_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StaffConfirmationRequest[]) : initialStaffRequests;
  } catch {
    return initialStaffRequests;
  }
}

function writeRequests(requests: StaffConfirmationRequest[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STAFF_REQUEST_STORAGE_KEY, JSON.stringify(requests));
}

export function getStaffRequests() {
  return readRequests();
}

export function saveStaffRequests(requests: StaffConfirmationRequest[]) {
  writeRequests(requests);
}

export function createStaffRequest(input: {
  aiWorkId: string;
  title: string;
  question: string;
  internalReason: string;
  requestedByName?: string;
  staffName?: string;
}) {
  const now = nowIso();
  const title = input.title;
  const question = input.question;
  const request: StaffConfirmationRequest = {
    id: makeId("staff-request"),
    companyId: "flowfit-demo",
    aiWorkId: input.aiWorkId,
    requestedByUserId: "owner-demo",
    requestedByName: input.requestedByName ?? "대표",
    staffId: "staff-kim",
    staffName: input.staffName ?? "김직원",
    staffContact: "010-1234-5678",
    channel: "manual",
    status: "waiting_approval",
    title,
    question,
    responseOptions: ["접수됨", "미접수", "확인 중"],
    messagePreview: `[FlowFit 확인 요청 · 사장 요청]\n\n${title}\n\n확인할 내용:\n${question}\n\n응답:\n[접수됨] [미접수] [확인 중]`,
    internalReason: input.internalReason,
    createdAt: now,
    updatedAt: now,
  };

  const nextRequests = [request, ...readRequests()];
  writeRequests(nextRequests);
  return request;
}

export function updateStaffRequest(
  requestId: string,
  updater: (request: StaffConfirmationRequest) => StaffConfirmationRequest,
) {
  const nextRequests = readRequests().map((request) => (request.id === requestId ? updater(request) : request));
  writeRequests(nextRequests);
  return nextRequests;
}

