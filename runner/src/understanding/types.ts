// understanding/types.ts
// intakes 원문을 업무 후보(tasks)로 바꾸는 구조화 결과.

export type BusinessTaskType =
  | "order_request"
  | "quote_request"
  | "delivery_inquiry"
  | "payment_report"
  | "reply_draft"
  | "complaint"
  | "automation_request"
  | "report_request"
  | "inventory_inquiry"
  | "invoice_request"
  | "return_exchange"
  | "order_update"
  | "data_update"
  | "general_request"
  | "unknown";

export type BusinessRiskLevel = "low" | "medium" | "high" | "uncertain";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface ExtractedBusinessFields {
  customerName?: string;
  itemName?: string;
  quantity?: number;
  unit?: string;
  dueDateText?: string;
  dueDate?: string;
  priority?: TaskPriority;
  deliveryAddress?: string;
  orderNumber?: string;
  trackingNumber?: string;
  amount?: number;
  depositorName?: string;
  contactName?: string;
  requestedReplyChannel?: string;
}

export interface TaskUnderstandingResult {
  taskType: BusinessTaskType;
  title: string;
  summary: string;
  fields: ExtractedBusinessFields;
  missingFields: string[];
  confidence: number;
  riskLevel: BusinessRiskLevel;
  recommendedAction: string;
  evidence: string[];
  needsHumanReview: boolean;
  engine: "llm" | "heuristic";
}

export interface UnderstandingInput {
  intakeId?: string;
  companyId: string;
  sourceType: string;
  sourceName?: string;
  rawText: string;
  receivedAt?: string;
}
