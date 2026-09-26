// approvals/types.ts
// Runner의 승인 필요 이벤트를 Studio 승인함 카드로 전달하기 위한 구조.

export type ApprovalRequestStatus = "pending" | "approved" | "rejected" | "expired";

export interface CreateApprovalRequestInput {
  companyId: string;
  taskId?: string;
  runId?: string;
  action: string;
  reason: string;
  title?: string;
  description?: string;
  source?: string;
  riskLevel?: "low" | "medium" | "high";
  approvalPolicy?: "owner_only" | "approval_required";
  expiresAt?: string;
  ttlMinutes?: number;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRequestRecord {
  id: string;
  companyId: string;
  taskId?: string;
  title: string;
  description?: string;
  options: Record<string, unknown>;
  status: ApprovalRequestStatus;
  selectedOption?: string;
  resolvedBy?: string;
  createdAt: string;
  expiresAt?: string;
  resolvedAt?: string;
}
