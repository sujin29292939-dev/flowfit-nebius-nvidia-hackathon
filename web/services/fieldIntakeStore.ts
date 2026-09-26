import type { IntakeUrgency, RawFieldIntake, RawFieldIntakeStatus } from "@/types/flowfit";

const FIELD_INTAKE_STORAGE_KEY = "flowfit-field-intakes";

function nowIso() {
  return new Date().toISOString();
}

export function makeFlowFitId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const initialRawFieldIntakes: RawFieldIntake[] = [
  {
    id: "field-intake-a-order",
    companyId: "flowfit-demo",
    submittedByStaffId: "staff-kim",
    submittedByName: "김직원",
    rawText: "A거래처 3박스 더 달라고 함. 내일까지 가능한지 물어봄.",
    imageUrls: ["placeholder:purchase-order"],
    fileUrls: [],
    urgency: "today",
    clientCreatedAt: "2026-04-29T09:10:00+09:00",
    serverReceivedAt: "2026-04-29T09:11:00+09:00",
    networkInfo: {
      userAgent: "FlowFit quick intake",
      ipHash: "iphash-demo-01",
    },
    status: "waiting_owner_review",
    aiFormId: "auto-form-a-order",
    businessContextEventId: "business-event-a-order",
    createdAt: "2026-04-29T09:11:00+09:00",
    updatedAt: "2026-04-29T09:13:00+09:00",
  },
  {
    id: "field-intake-b-receipt",
    companyId: "flowfit-demo",
    submittedByStaffId: "staff-park",
    submittedByName: "박직원",
    rawText: "현장에서 입금했다고 영수증 보여줌.",
    imageUrls: ["placeholder:receipt"],
    fileUrls: [],
    urgency: "normal",
    clientCreatedAt: "2026-04-29T10:18:00+09:00",
    serverReceivedAt: "2026-04-29T10:20:00+09:00",
    status: "waiting_owner_review",
    aiFormId: "auto-form-b-receipt",
    businessContextEventId: "business-event-b-receipt",
    createdAt: "2026-04-29T10:20:00+09:00",
    updatedAt: "2026-04-29T10:22:00+09:00",
  },
  {
    id: "field-intake-c-complaint",
    companyId: "flowfit-demo",
    submittedByStaffId: "staff-lee",
    submittedByName: "이직원",
    rawText: "고객이 배송 늦는다고 화냄. 오늘 중 연락 달라 함.",
    imageUrls: [],
    fileUrls: [],
    urgency: "urgent",
    clientCreatedAt: "2026-04-29T11:04:00+09:00",
    serverReceivedAt: "2026-04-29T11:04:00+09:00",
    status: "waiting_owner_review",
    aiFormId: "auto-form-c-complaint",
    businessContextEventId: "business-event-c-complaint",
    createdAt: "2026-04-29T11:04:00+09:00",
    updatedAt: "2026-04-29T11:06:00+09:00",
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

export function getRawFieldIntakes() {
  return readJson(FIELD_INTAKE_STORAGE_KEY, initialRawFieldIntakes);
}

export function saveRawFieldIntakes(intakes: RawFieldIntake[]) {
  writeJson(FIELD_INTAKE_STORAGE_KEY, intakes);
}

export function createRawFieldIntake(input: {
  companyId?: string;
  submittedByStaffId?: string;
  submittedByName?: string;
  rawText?: string;
  imageUrls?: string[];
  voiceMemoUrl?: string;
  fileUrls?: string[];
  urgency: IntakeUrgency;
  userAgent?: string;
}) {
  const now = nowIso();
  const intake: RawFieldIntake = {
    id: makeFlowFitId("field-intake"),
    companyId: input.companyId ?? "flowfit-demo",
    submittedByStaffId: input.submittedByStaffId,
    submittedByName: input.submittedByName,
    rawText: input.rawText,
    imageUrls: input.imageUrls ?? [],
    voiceMemoUrl: input.voiceMemoUrl,
    fileUrls: input.fileUrls ?? [],
    urgency: input.urgency,
    clientCreatedAt: now,
    serverReceivedAt: now,
    networkInfo: {
      userAgent: input.userAgent,
      ipHash: "browser-session-hash",
    },
    status: "uploaded",
    createdAt: now,
    updatedAt: now,
  };

  saveRawFieldIntakes([intake, ...getRawFieldIntakes()]);
  return intake;
}

export function updateRawFieldIntake(
  intakeId: string,
  updater: (intake: RawFieldIntake) => RawFieldIntake,
) {
  const nextIntakes = getRawFieldIntakes().map((intake) => (intake.id === intakeId ? updater(intake) : intake));
  saveRawFieldIntakes(nextIntakes);
  return nextIntakes;
}

export function setRawFieldIntakeStatus(intakeId: string, status: RawFieldIntakeStatus) {
  return updateRawFieldIntake(intakeId, (intake) => ({
    ...intake,
    status,
    updatedAt: nowIso(),
  }));
}
