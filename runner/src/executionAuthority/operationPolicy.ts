export type OperationGateLevel = "SAFE" | "CONFIRM" | "BLOCK";

export interface OperationPolicy {
  op: string;
  level: OperationGateLevel;
  reason: string;
}

export interface OperationGateResult {
  level: OperationGateLevel;
  requiresApproval: boolean;
  blocked: boolean;
  steps: OperationPolicy[];
  reasons: string[];
}

export const EXECUTION_AUTHORITY_VERSION = 1;
export const EXECUTION_AUTHORITY_SOURCE = "flowfit-runner/executionAuthority/operationPolicy";

const SAFE_OPS = new Set([
  "TAB_LIST", "TAB_NEW", "TAB_ACTIVATE", "TAB_INFO",
  "NAVIGATE", "BACK", "FORWARD", "RELOAD",
  "GET_HTML", "GET_TEXT", "FIND_ELEMENTS", "GET_ATTR",
  "CLICK", "TYPE", "CLEAR", "SELECT", "SCROLL", "FOCUS", "HOVER", "KEY_PRESS",
  "SCREENSHOT", "SCREENSHOT_ELEMENT", "WAIT_FOR", "WAIT_MS",
  "UIA_READ", "UIA_FIND", "READ_CELL", "READ_FILE",
]);

const CONFIRM_OPS = new Set([
  "SUBMIT", "TAB_CLOSE",
  "GET_COOKIES", "SET_COOKIE", "GET_LOCALSTORAGE", "SET_LOCALSTORAGE", "GET_NETWORK_LOG",
  "SAVE", "SAVE_FILE", "WRITE_CELL", "SUBMIT_FORM", "SEND", "UPLOAD",
]);

const BLOCK_OPS = new Set([
  "EVAL", "EXEC_SCRIPT", "RUN_SHELL", "DELETE_ALL", "EXPORT_ALL",
]);

export function normalizeOperation(op: unknown): string {
  return String(op ?? "").trim().toUpperCase();
}

export function getOperationPolicy(op: unknown): OperationPolicy {
  const name = normalizeOperation(op);
  if (BLOCK_OPS.has(name)) {
    return {
      op: name,
      level: "BLOCK",
      reason: "Arbitrary script execution, bulk deletion, and bulk export are always blocked.",
    };
  }
  if (CONFIRM_OPS.has(name)) {
    return {
      op: name,
      level: "CONFIRM",
      reason: "State-changing or sensitive operations require approval before execution.",
    };
  }
  if (SAFE_OPS.has(name)) {
    return {
      op: name,
      level: "SAFE",
      reason: "Read, navigation, reversible input, or observation operation.",
    };
  }
  return {
    op: name || "UNKNOWN",
    level: "BLOCK",
    reason: "Unknown operations are blocked by default.",
  };
}

export function evaluateOperations(
  steps: Array<{ op: string }>,
  options: { approved?: boolean } = {},
): OperationGateResult {
  const policies = steps.map((step) => getOperationPolicy(step.op));
  const hasBlock = policies.some((policy) => policy.level === "BLOCK");
  const hasConfirm = policies.some((policy) => policy.level === "CONFIRM");
  const level: OperationGateLevel = hasBlock ? "BLOCK" : hasConfirm ? "CONFIRM" : "SAFE";
  const blocked = hasBlock;
  const requiresApproval = hasConfirm && !options.approved;

  const reasons: string[] = [];
  for (const policy of policies) {
    if (policy.level === "BLOCK") reasons.push(`[BLOCK] ${policy.op}: ${policy.reason}`);
    if (policy.level === "CONFIRM") reasons.push(`[APPROVAL_REQUIRED] ${policy.op}: ${policy.reason}`);
  }

  return { level, requiresApproval, blocked, steps: policies, reasons };
}

export function exportOperationPolicySnapshot() {
  return {
    version: EXECUTION_AUTHORITY_VERSION,
    source: EXECUTION_AUTHORITY_SOURCE,
    safe: [...SAFE_OPS].sort(),
    confirm: [...CONFIRM_OPS].sort(),
    block: [...BLOCK_OPS].sort(),
    generatedAt: new Date().toISOString(),
  };
}
