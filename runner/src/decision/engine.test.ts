import assert from "node:assert/strict";
import { decideTaskAction } from "./engine.js";
import type { CompanyContextCatalog, CompanyContextResult, TaskForContext } from "../context/types.js";

const baseTask: TaskForContext = {
  id: "task_test",
  companyId: "company_demo",
  taskType: "order_request",
  status: "pending_policy",
  extractedFields: {
    customerName: "A거래처",
    itemName: "A품목",
    quantity: 3,
    priority: "high",
    dueDate: "2026-07-05T09:00:00.000Z",
  },
  riskLevel: "medium",
  confidence: 0.92,
};

const matchedContext: CompanyContextResult = {
  taskId: baseTask.id,
  companyId: baseTask.companyId,
  taskType: baseTask.taskType,
  status: "matched",
  contextConfidence: 0.95,
  customer: { kind: "exact", id: "cust_1", name: "A거래처", score: 1, reason: "exact", candidates: [] },
  item: { kind: "exact", id: "item_1", name: "A품목", score: 1, reason: "exact", candidates: [] },
  inventory: {
    status: "enough",
    itemId: "item_1",
    itemName: "A품목",
    requestedQuantity: 3,
    quantity: 10,
    safetyQuantity: 2,
    availableToPromise: 8,
    reason: "enough",
  },
  missingContext: [],
  decisionHints: [],
  recommendedAction: "주문 처리",
  matchedAt: "2026-07-04T00:00:00.000Z",
};

const auto = decideTaskAction({ task: baseTask, context: matchedContext });
assert.equal(auto.outcome, "AUTO_RUN");

const highAmount = decideTaskAction({
  task: { ...baseTask, extractedFields: { ...baseTask.extractedFields, amount: 900_000 } },
  context: matchedContext,
});
assert.equal(highAmount.outcome, "APPROVAL_REQUIRED");

const catalog: CompanyContextCatalog = {
  customers: [],
  items: [
    { id: "item_1", companyId: "company_demo", name: "A품목", aliases: [] },
    { id: "item_2", companyId: "company_demo", name: "A품목 대체", aliases: [] },
  ],
  inventory: [
    { itemId: "item_1", quantity: 0, safetyQuantity: 0 },
    { itemId: "item_2", quantity: 9, safetyQuantity: 1 },
  ],
};

const shortage = decideTaskAction({
  task: baseTask,
  context: {
    ...matchedContext,
    inventory: { ...matchedContext.inventory, status: "shortage", quantity: 0, availableToPromise: 0 },
  },
  catalog,
});
assert.equal(shortage.outcome, "SUGGEST_ALTERNATIVE");
assert.equal(shortage.suggestedAlternatives[0]?.itemName, "A품목 대체");

console.log("decision.engine.test passed");
