import type { AiWorkItem, AutoProcessedRecord } from "@/types/flowfit";

const AI_WORKS_STORAGE_KEY = "flowfit-ai-work-items";
const AUTO_LOG_STORAGE_KEY = "flowfit-auto-processed-records";
const RUNNER_TASK_WORK_PREFIX = "runner-task-";

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const initialAiWorkItems: AiWorkItem[] = [
  {
    id: "ai-work-delivery-delay-approval",
    companyId: "flowfit-demo",
    title: "고객 배송 지연 안내 문자",
    type: "customer_reply",
    status: "waiting_approval",
    riskLevel: "medium",
    approvalPolicy: "approval_required",
    sourceType: "sms",
    sourceSummary: "고객 문자",
    requestedByUserId: "owner-demo",
    requestedByName: "대표",
    aiReasonSummary: "고객 불만 가능성이 있어 사과와 재안내 시간이 필요함",
    resultTitle: "배송 지연 안내 문자 초안",
    resultContent:
      "안녕하세요. 배송이 지연되어 죄송합니다. 현재 물류 확인 중이며, 오늘 오후 5시 전까지 다시 안내드리겠습니다.",
    previewMessage:
      "고객에게 직접 발송될 수 있는 문구라 사과 표현과 재안내 시간을 승인받아야 합니다.",
    instructionHistory: [],
    steps: [
      { id: "delivery-step-1", label: "고객 문의 내용 확인", status: "done" },
      { id: "delivery-step-2", label: "배송 지연 불만 가능성 분석", status: "done" },
      { id: "delivery-step-3", label: "안내 문자 초안 생성", status: "done" },
      { id: "delivery-step-4", label: "대표 승인 대기", status: "running" },
    ],
    executionPreview: {
      serviceName: "문자 발송 콘솔",
      screenName: "고객 문의 상세",
      safeActionSummary: ["고객 문의 문장을 확인했습니다.", "배송 지연 기준 문구와 비교했습니다."],
      lastUpdatedAt: "2026-04-28T16:46:00+09:00",
    },
    createdAt: "2026-04-28T16:42:00+09:00",
    updatedAt: "2026-04-28T16:46:00+09:00",
  },
  {
    id: "ai-work-order-missing-approval",
    companyId: "flowfit-demo",
    title: "거래처 A 발주 누락 확인",
    type: "order_check",
    status: "waiting_approval",
    riskLevel: "uncertain",
    approvalPolicy: "staff_confirmation_required",
    sourceType: "email",
    sourceSummary: "이메일",
    requestedByUserId: "manager-demo",
    requestedByName: "관리자",
    aiReasonSummary: "발주 누락 가능성이 있어 내부 직원 확인이 필요함",
    resultTitle: "김직원에게 보낼 확인 요청 초안",
    resultContent: "A거래처 발주가 오늘 접수되었는지 확인해주세요.",
    previewMessage: "담당 직원 확인 후 발주 누락 여부를 다시 승인함에 표시합니다.",
    assignedStaffRequestId: "staff-request-order-a",
    instructionHistory: [],
    steps: [
      { id: "order-step-1", label: "거래처 이메일 확인", status: "done" },
      { id: "order-step-2", label: "기존 발주 기록 비교", status: "done" },
      { id: "order-step-3", label: "직원 확인 요청 초안 생성", status: "done" },
      { id: "order-step-4", label: "대표 승인 대기", status: "running" },
    ],
    executionPreview: {
      serviceName: "이메일",
      screenName: "거래처 A 발주 메일",
      safeActionSummary: ["메일 제목과 발주 키워드를 확인했습니다.", "기존 발주 기록과 일치하지 않는 항목을 표시했습니다."],
      lastUpdatedAt: "2026-04-28T16:45:00+09:00",
    },
    createdAt: "2026-04-28T16:38:00+09:00",
    updatedAt: "2026-04-28T16:45:00+09:00",
  },
  {
    id: "ai-work-inventory-shortage-running",
    companyId: "flowfit-demo",
    title: "재고 부족 보고서 생성",
    type: "inventory_check",
    status: "drafting",
    riskLevel: "medium",
    approvalPolicy: "approval_required",
    sourceType: "file",
    sourceSummary: "재고 파일",
    requestedByUserId: "owner-demo",
    requestedByName: "대표",
    aiReasonSummary: "기준치 이하 품목을 정리해 발주 판단에 필요한 요약을 만들고 있습니다.",
    resultTitle: "사장 보고용 요약 보고서",
    resultContent: "재고 부족 품목과 권장 확인 항목을 보고서 초안으로 생성 중입니다.",
    previewMessage: "재고 발주 판단에 영향을 줄 수 있어 승인 필요",
    instructionHistory: [],
    steps: [
      { id: "inventory-step-1", label: "재고 파일 확인 완료", status: "done" },
      { id: "inventory-step-2", label: "기준치 이하 품목 분석 완료", status: "done" },
      { id: "inventory-step-3", label: "보고서 초안 작성 중", status: "running" },
      { id: "inventory-step-4", label: "관리자 승인 대기 예정", status: "pending" },
    ],
    executionPreview: {
      serviceName: "재고 스프레드시트",
      screenName: "4월 재고 현황",
      safeActionSummary: [
        "품목별 현재 수량을 확인했습니다.",
        "안전재고 기준보다 낮은 품목을 분리했습니다.",
        "홍길동 담당 품목은 홍**로 가려 표시합니다.",
      ],
      lastUpdatedAt: "2026-04-28T16:52:00+09:00",
    },
    createdAt: "2026-04-28T16:48:00+09:00",
    updatedAt: "2026-04-28T16:52:00+09:00",
  },
];

export const initialAutoProcessedRecords: AutoProcessedRecord[] = [
  {
    id: "auto-log-unanswered-classification",
    aiWorkId: "ai-work-auto-unanswered-classification",
    title: "어제 미응답 문의 분류",
    processedAt: "2026-04-28T09:02:00+09:00",
    source: "고객 문의함",
    result: "8건 중 배송 문의 3건, 주문 변경 2건, 일반 문의 3건으로 분류",
    reason: "고객에게 직접 발송하지 않는 내부 분류 작업",
    reversible: true,
    status: "auto_completed",
  },
];

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function getAiWorkItems() {
  return readJson(AI_WORKS_STORAGE_KEY, initialAiWorkItems);
}

export function isRunnerTaskWork(work: AiWorkItem) {
  return work.id.startsWith(RUNNER_TASK_WORK_PREFIX);
}

export async function fetchRunnerAiWorkItems(): Promise<AiWorkItem[]> {
  if (typeof window === "undefined") return [];
  const response = await fetch("/api/runner/tasks", { cache: "no-store" });
  if (!response.ok) return [];
  const body = (await response.json().catch(() => null)) as { tasks?: unknown[] } | null;
  return Array.isArray(body?.tasks) ? body.tasks.map(runnerTaskToAiWorkItem).filter(Boolean) as AiWorkItem[] : [];
}

export function saveAiWorkItems(items: AiWorkItem[]) {
  writeJson(AI_WORKS_STORAGE_KEY, items.filter((work) => !isRunnerTaskWork(work)));
}

export function resetAiWorkItems() {
  saveAiWorkItems(initialAiWorkItems);
  return initialAiWorkItems;
}

export function updateAiWorkItem(workId: string, updater: (work: AiWorkItem) => AiWorkItem) {
  const nextItems = getAiWorkItems().map((work) => (work.id === workId ? updater(work) : work));
  saveAiWorkItems(nextItems);
  return nextItems;
}

export function createAiWorkFromRequest(input: string, userName = "대표") {
  const now = nowIso();
  const work: AiWorkItem = {
    id: makeId("ai-work"),
    companyId: "flowfit-demo",
    title: input.length > 38 ? `${input.slice(0, 38)}...` : input,
    type: "manual_request",
    status: "queued",
    riskLevel: "medium",
    approvalPolicy: "approval_required",
    sourceType: "manual",
    sourceSummary: "AI 운영 요청실",
    requestedByUserId: "owner-demo",
    requestedByName: userName,
    aiReasonSummary: "대표/관리자가 요청한 운영 업무를 AI가 작업 객체로 전환했습니다.",
    resultTitle: "요청 처리 결과",
    resultContent: "자료 확인 후 승인함 또는 자동 처리 기록으로 이동합니다.",
    previewMessage: "요청을 처리하는 동안 AI 실행 중 화면에서 진행 상태를 확인할 수 있습니다.",
    instructionHistory: [
      {
        id: makeId("instruction"),
        userId: "owner-demo",
        userName,
        instruction: input,
        createdAt: now,
      },
    ],
    steps: [
      { id: makeId("step"), label: "요청 내용 확인", status: "running" },
      { id: makeId("step"), label: "관련 자료 확인", status: "pending" },
      { id: makeId("step"), label: "결과 초안 생성", status: "pending" },
      { id: makeId("step"), label: "승인 필요 여부 판단", status: "pending" },
    ],
    executionPreview: {
      serviceName: "FlowFit 운영 엔진",
      screenName: "AI 운영 요청실",
      safeActionSummary: ["요청 문장을 작업 단위로 나누고 있습니다."],
      lastUpdatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };

  const nextItems = [work, ...getAiWorkItems()];
  saveAiWorkItems(nextItems);
  return work;
}

export function getAutoProcessedRecords() {
  return readJson(AUTO_LOG_STORAGE_KEY, initialAutoProcessedRecords);
}

export function saveAutoProcessedRecords(records: AutoProcessedRecord[]) {
  writeJson(AUTO_LOG_STORAGE_KEY, records);
}

function runnerTaskToAiWorkItem(value: unknown): AiWorkItem | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Record<string, unknown>;
  const id = typeof task.id === "string" ? task.id : "";
  if (!id) return null;

  const fields = asRecord(task.extracted_fields_json);
  const decision = asRecord(fields.decision);
  const taskType = String(task.task_type ?? "manual_request");
  const status = String(task.status ?? "queued");
  const now = new Date().toISOString();

  return {
    id: `${RUNNER_TASK_WORK_PREFIX}${id}`,
    companyId: String(task.company_id ?? "flowfit-demo"),
    title: String(fields.title ?? fields.summary ?? taskType),
    type: mapRunnerTaskType(taskType),
    status: mapRunnerStatus(status),
    riskLevel: mapRisk(task.risk_level),
    approvalPolicy: mapApprovalPolicy(status, task.risk_level),
    sourceType: "system",
    sourceSummary: String(task.intake_id ?? "Runner task"),
    requestedByUserId: "flowfit-runner",
    requestedByName: "Runner",
    aiReasonSummary: String(decision.reason ?? fields.recommendedAction ?? fields.summary ?? "Runner가 업무 원문을 분석했습니다."),
    resultTitle: String(decision.title ?? fields.resultTitle ?? "Runner 처리 결과"),
    resultContent: String(decision.reason ?? fields.summary ?? fields.recommendedAction ?? "Runner 작업 결과를 확인하세요."),
    previewMessage: String(decision.outcome ?? status),
    instructionHistory: [],
    steps: [
      { id: `${id}-understand`, label: "업무 원문 이해", status: "done" },
      { id: `${id}-context`, label: "회사 정보 매칭", status: task.context_status === "matched" ? "done" : "running" },
      { id: `${id}-decision`, label: "처리 방식 판단", status: decision.outcome ? "done" : "pending" },
      { id: `${id}-execute`, label: "실행 또는 승인 대기", status: status === "completed" ? "done" : status === "failed" ? "failed" : "running" },
    ],
    executionPreview: {
      serviceName: "FlowFit Runner",
      screenName: String(task.task_type ?? "task"),
      safeActionSummary: [
        `상태: ${status}`,
        task.context_status ? `맥락 매칭: ${String(task.context_status)}` : "",
        decision.outcome ? `판단: ${String(decision.outcome)}` : "",
      ].filter(Boolean),
      lastUpdatedAt: toIso(task.updated_at) ?? now,
    },
    createdAt: toIso(task.created_at) ?? now,
    updatedAt: toIso(task.updated_at) ?? now,
    completedAt: status === "completed" ? (toIso(task.updated_at) ?? now) : undefined,
  };
}

function mapRunnerTaskType(taskType: string): AiWorkItem["type"] {
  if (taskType === "order_request") return "order_check";
  if (taskType === "quote_request" || taskType === "report_request") return "report";
  if (taskType === "delivery_inquiry" || taskType === "complaint" || taskType === "reply_draft") return "customer_reply";
  if (taskType === "payment_report") return "report";
  if (taskType === "automation_request") return "automation";
  return "manual_request";
}

function mapRunnerStatus(status: string): AiWorkItem["status"] {
  if (status === "completed") return "completed";
  if (status === "approval_required" || status === "waiting_approval") return "waiting_approval";
  if (status === "retry_pending" || status === "failed" || status === "connector_reauth_required") return "failed";
  if (status === "blocked" || status === "approval_rejected") return "cancelled";
  if (status === "ready_to_execute" || status === "connector_executing") return "drafting";
  if (status === "pending_policy" || status === "needs_review") return "analyzing";
  return "queued";
}

function mapRisk(value: unknown): AiWorkItem["riskLevel"] {
  return value === "low" || value === "medium" || value === "high" || value === "uncertain" ? value : "medium";
}

function mapApprovalPolicy(status: string, risk: unknown): AiWorkItem["approvalPolicy"] {
  if (risk === "high") return "owner_only";
  if (status === "approval_required" || status === "waiting_approval") return "approval_required";
  return "approval_required";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toIso(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
