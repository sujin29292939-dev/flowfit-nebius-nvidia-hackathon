// agent/executionBrief.ts
// 도메인 파이프라인이 범용 에이전트에게 넘기는 실행 계약.
// 핵심은 "어떤 도구를 쓸 수 있나"가 아니라 "어떤 행동까지 허용하나"다.

export type ActionDecision = "allowed" | "approval_required" | "blocked";

export type ExecutionStepFailurePolicy = "stop" | "skip" | "ask";

export interface ExecutionPlanStep {
  id: string;
  title: string;
  objective: string;
  allowedActions: string[];
  onFailure: ExecutionStepFailurePolicy;
}

export interface ExecutionBrief {
  companyId?: string;
  taskId?: string;
  intakeId?: string;

  objective: string;
  taskType?: string;
  riskLevel?: "low" | "medium" | "high" | "uncertain";

  allowedTools?: string[];
  allowedActions?: string[];
  blockedActions?: string[];
  requiredApprovalActions?: string[];

  executionPlan?: ExecutionPlanStep[];
  notes?: string[];
}

export interface ActionGuardDecision {
  decision: ActionDecision;
  reason: string;
  allowedTools: string[];
}
