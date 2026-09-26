// understanding/schema.ts
// LLM 결과와 휴리스틱 결과를 같은 형태로 검증한다.

import { z } from "zod";

export const BusinessTaskTypeSchema = z.enum([
  "order_request",
  "quote_request",
  "delivery_inquiry",
  "payment_report",
  "reply_draft",
  "complaint",
  "automation_request",
  "report_request",
  "inventory_inquiry",
  "invoice_request",
  "return_exchange",
  "order_update",
  "data_update",
  "general_request",
  "unknown",
]);

export const RiskLevelSchema = z.enum(["low", "medium", "high", "uncertain"]);
export const TaskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const TaskUnderstandingSchema = z.object({
  taskType: BusinessTaskTypeSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  fields: z.object({
    customerName: z.string().optional(),
    itemName: z.string().optional(),
    quantity: z.number().optional(),
    unit: z.string().optional(),
    dueDateText: z.string().optional(),
    dueDate: z.string().optional(),
    priority: TaskPrioritySchema.optional(),
    deliveryAddress: z.string().optional(),
    orderNumber: z.string().optional(),
    trackingNumber: z.string().optional(),
    amount: z.number().optional(),
    depositorName: z.string().optional(),
    contactName: z.string().optional(),
    requestedReplyChannel: z.string().optional(),
  }),
  missingFields: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  riskLevel: RiskLevelSchema,
  recommendedAction: z.string().min(1),
  evidence: z.array(z.string()),
  needsHumanReview: z.boolean(),
  engine: z.enum(["llm", "heuristic"]).optional(),
});
