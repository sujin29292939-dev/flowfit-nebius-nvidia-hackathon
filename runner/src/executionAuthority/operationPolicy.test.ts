import { strict as assert } from "node:assert";

import {
  evaluateOperations,
  exportOperationPolicySnapshot,
  getOperationPolicy,
} from "./operationPolicy.js";

function check(name: string, condition: boolean) {
  assert.ok(condition, name);
  console.log(`[ok] ${name}`);
}

const snapshot = exportOperationPolicySnapshot();
const allOps = [...snapshot.safe, ...snapshot.confirm, ...snapshot.block];
const uniqueOps = new Set(allOps);

check("all operation names are unique across SAFE/CONFIRM/BLOCK", uniqueOps.size === allOps.length);
check("EVAL is blocked", getOperationPolicy("EVAL").level === "BLOCK");
check("unknown operations are blocked", getOperationPolicy("SOMETHING_NEW").level === "BLOCK");
check("SUBMIT requires approval before approval", evaluateOperations([{ op: "SUBMIT" }]).requiresApproval === true);
check("SUBMIT is allowed after approval", evaluateOperations([{ op: "SUBMIT" }], { approved: true }).requiresApproval === false);
check("mixed SAFE + CONFIRM resolves to CONFIRM", evaluateOperations([{ op: "GET_TEXT" }, { op: "SAVE" }]).level === "CONFIRM");
check("any BLOCK wins over CONFIRM", evaluateOperations([{ op: "SAVE" }, { op: "EVAL" }]).level === "BLOCK");
check("snapshot names its single authority source", snapshot.source === "flowfit-runner/executionAuthority/operationPolicy");
