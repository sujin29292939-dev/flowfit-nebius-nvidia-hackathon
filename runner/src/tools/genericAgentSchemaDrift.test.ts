import { ACTION_TOOL_MAP } from "./actionGuard.js";
import {
  GENERIC_AGENT_READ_ACTIONS,
  GENERIC_AGENT_WRITE_ACTIONS,
  classifyGenericAgentAction,
} from "./genericAgentOfflinePolicy.js";

function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

const readActions = new Set<string>(GENERIC_AGENT_READ_ACTIONS);
const writeActions = new Set<string>(GENERIC_AGENT_WRITE_ACTIONS);
const classifiedActions = new Set<string>([...readActions, ...writeActions]);

const overlap = [...readActions].filter((action) => writeActions.has(action));
check("Generic Agent schema drift: read/write action sets do not overlap", overlap.length === 0);

const missingFromClassification = Object.keys(ACTION_TOOL_MAP).filter((action) => !classifiedActions.has(action));
check(
  `Generic Agent schema drift: every ActionGuard action is classified (${missingFromClassification.join(", ") || "none"})`,
  missingFromClassification.length === 0,
);

for (const action of readActions) {
  check(`Generic Agent schema drift: ${action} classifies as read`, classifyGenericAgentAction(action) === "read");
}

for (const action of writeActions) {
  check(`Generic Agent schema drift: ${action} classifies as write`, classifyGenericAgentAction(action) === "write");
}

check(
  "Generic Agent schema drift: unknown action fails closed as write",
  classifyGenericAgentAction("new_unregistered_action") === "write",
);
