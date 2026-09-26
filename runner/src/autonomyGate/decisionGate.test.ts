import assert from "node:assert/strict";

import { evaluateTaskAutonomy } from "./decisionGate.js";
import type { GateResult } from "./types.js";

const autoEligibleGate: Pick<GateResult, "decision" | "mode" | "effectiveOutcome"> = {
  mode: "AUTO",
  effectiveOutcome: "AUTO_SEND",
  decision: {
    outcome: "AUTO_SEND",
    matchedCriterionId: "low-risk-order",
    matchedKeywords: ["order"],
    scores: { confidence: 0.96, criteriaMatch: true },
    decidedAt: "2026-07-08T00:00:00.000Z",
  },
};

const noApprovalWriteInput = {
  capability: "order.create",
  riskLevel: "low" as const,
  gate: autoEligibleGate,
  deviceMode: "ONLINE" as const,
  rule: {
    id: "no-rule",
    serverSafeFlag: false,
    connectorPath: true,
    idempotentWrite: false,
    approvalCount: 0,
  },
};

const decideGate = evaluateTaskAutonomy(noApprovalWriteInput);
const executeGate = evaluateTaskAutonomy(noApprovalWriteInput);

assert.notEqual(decideGate.decision, "AUTO");
assert.notEqual(executeGate.decision, "AUTO");
assert.equal(decideGate.decision, "SHADOW");
assert.equal(executeGate.decision, "SHADOW");

assert.deepEqual(
  {
    decision: decideGate.decision,
    reason: decideGate.reason,
    blockedBy: decideGate.blockedBy,
    writeCapability: decideGate.writeCapability,
  },
  {
    decision: executeGate.decision,
    reason: executeGate.reason,
    blockedBy: executeGate.blockedBy,
    writeCapability: executeGate.writeCapability,
  },
);

console.log("autonomyGate.decisionGate.test passed");
