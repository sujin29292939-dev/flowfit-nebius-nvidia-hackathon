import type { AiWorkItem, ApprovalPolicy } from "@/types/flowfit";

function hasExternalMessage(work: AiWorkItem) {
  return (
    work.type === "customer_reply" ||
    work.type === "external_message" ||
    work.sourceType === "sms" ||
    work.sourceType === "email" ||
    work.sourceType === "messenger"
  );
}

export function determineApprovalPolicy(work: AiWorkItem): ApprovalPolicy {
  if (work.riskLevel === "low" && !hasExternalMessage(work)) {
    return "auto_allowed";
  }

  if (work.riskLevel === "medium" && hasExternalMessage(work)) {
    return "approval_required";
  }

  if (work.riskLevel === "high") {
    return "owner_only";
  }

  if (work.riskLevel === "uncertain") {
    return "staff_confirmation_required";
  }

  return work.approvalPolicy;
}

export function canAutoProcess(work: AiWorkItem) {
  return determineApprovalPolicy(work) === "auto_allowed";
}

export function requiresOwnerApproval(work: AiWorkItem) {
  return determineApprovalPolicy(work) === "owner_only";
}

export function requiresStaffConfirmation(work: AiWorkItem) {
  return determineApprovalPolicy(work) === "staff_confirmation_required";
}

