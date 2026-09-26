import type { CompanyContextCatalog, CompanyContextResult, TaskForContext } from "../context/types.js";
import type { TaskPriority } from "../understanding/types.js";

export type DecisionOutcome =
  | "AUTO_RUN"
  | "APPROVAL_REQUIRED"
  | "SUGGEST_ALTERNATIVE"
  | "MANUAL_REVIEW"
  | "BLOCKED";

export interface AlternativeItemSuggestion {
  itemId: string;
  itemName: string;
  availableToPromise: number;
  reason: string;
}

export interface TaskDecisionResult {
  outcome: DecisionOutcome;
  action: string;
  title: string;
  reason: string;
  approvalAction?: string;
  priority: TaskPriority;
  dueDate?: string;
  riskLevel: string;
  suggestedAlternatives: AlternativeItemSuggestion[];
  evidence: string[];
  decidedAt: string;
}

export interface DecisionEngineInput {
  task: TaskForContext;
  context?: CompanyContextResult | Record<string, unknown>;
  catalog?: CompanyContextCatalog;
  ruleMemory?: Array<Record<string, unknown>>;
  amountApprovalThreshold?: number;
}
