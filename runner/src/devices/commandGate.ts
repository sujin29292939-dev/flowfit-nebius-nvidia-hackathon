import {
  evaluateOperations,
  exportOperationPolicySnapshot,
  getOperationPolicy,
  normalizeOperation,
  type OperationGateLevel,
  type OperationGateResult,
  type OperationPolicy,
} from "../executionAuthority/operationPolicy.js";

export type GateLevel = OperationGateLevel;
export type GatePolicy = OperationPolicy;
export type CommandGateResult = OperationGateResult;

export function normalizeOp(op: unknown): string {
  return normalizeOperation(op);
}

export function gatePolicyForOp(op: unknown): GatePolicy {
  return getOperationPolicy(op);
}

export function evaluateCommandGate(
  steps: Array<{ op: string }>,
  options: { approved?: boolean } = {},
): CommandGateResult {
  return evaluateOperations(steps, options);
}

export function exportGateSnapshot() {
  return exportOperationPolicySnapshot();
}
