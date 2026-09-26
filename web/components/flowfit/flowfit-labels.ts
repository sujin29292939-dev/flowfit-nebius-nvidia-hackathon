import type { AiWorkStatus, AiWorkStepStatus, AiWorkType, ApprovalPolicy, RiskLevel, StaffRequestStatus } from "@/types/flowfit";

export const aiWorkStatusLabels: Record<AiWorkStatus, string> = {
  queued: "대기 중",
  collecting: "자료 확인 중",
  analyzing: "내용 분석 중",
  drafting: "결과 생성 중",
  checking: "위험도 확인 중",
  waiting_approval: "승인 대기",
  revision_needed: "수정 필요",
  assigned_to_staff: "직원 확인 중",
  completed: "완료",
  auto_completed: "자동 처리됨",
  failed: "처리 실패",
  cancelled: "취소됨",
};

export const aiWorkTypeLabels: Record<AiWorkType, string> = {
  customer_reply: "고객 답장",
  order_check: "발주 확인",
  inventory_check: "재고 확인",
  report: "보고서",
  staff_confirmation: "직원 확인",
  external_message: "외부 발송",
  reminder: "알림",
  automation: "자동화",
  manual_request: "운영 요청",
};

export const riskLevelLabels: Record<RiskLevel, string> = {
  low: "낮음",
  medium: "중간",
  high: "높음",
  uncertain: "확인 필요",
};

export const approvalPolicyLabels: Record<ApprovalPolicy, string> = {
  auto_allowed: "자동 처리 가능",
  approval_required: "승인 필요",
  owner_only: "대표 승인 필요",
  staff_confirmation_required: "직원 확인 필요",
};

export const stepStatusLabels: Record<AiWorkStepStatus, string> = {
  done: "완료",
  running: "진행 중",
  pending: "예정",
  failed: "실패",
};

export const staffRequestStatusLabels: Record<StaffRequestStatus, string> = {
  draft: "초안",
  waiting_approval: "발송 승인 대기",
  sent: "발송됨",
  responded: "응답 완료",
  expired: "만료",
  cancelled: "취소됨",
};

export function getStatusVariant(
  status: AiWorkStatus,
): "default" | "success" | "warning" | "danger" | "info" {
  if (status === "completed" || status === "auto_completed") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "waiting_approval" || status === "checking" || status === "revision_needed") return "warning";
  if (status === "assigned_to_staff") return "info";
  return "default";
}

export function getRiskVariant(riskLevel: RiskLevel): "default" | "success" | "warning" | "danger" | "info" {
  if (riskLevel === "low") return "success";
  if (riskLevel === "medium") return "warning";
  if (riskLevel === "high") return "danger";
  return "info";
}

