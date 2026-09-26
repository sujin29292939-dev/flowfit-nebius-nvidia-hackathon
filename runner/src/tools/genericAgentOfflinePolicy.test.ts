import { evaluateOfflineDemotion } from "../connectors/offlinePolicy.js";
import { applyGenericAgentOfflineDemotion, classifyGenericAgentAction } from "./genericAgentOfflinePolicy.js";

function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

check(
  "Generic Agent: shared offline policy demotes recovering write path",
  evaluateOfflineDemotion({
    deviceMode: "RECOVERING",
    connectorPath: "generic_agent",
    capability: "inquiry.reply",
    idempotencySupported: true,
    serverSafeRule: true,
  }).shouldDemote === true,
);

check(
  "Generic Agent: read action stays AUTO while offline",
  applyGenericAgentOfflineDemotion({
    policyTier: "AUTO",
    action: "read_inventory",
    deviceMode: "OFFLINE",
  }).tier === "AUTO",
);

check(
  "Generic Agent: write action AUTO demotes to ASSIST while offline",
  applyGenericAgentOfflineDemotion({
    policyTier: "AUTO",
    action: "create_order",
    deviceMode: "OFFLINE",
  }).tier === "ASSIST",
);

check(
  "Generic Agent: unknown action is treated as write",
  classifyGenericAgentAction("custom_external_write") === "write",
);

check(
  "Generic Agent: SHADOW is not demoted further",
  applyGenericAgentOfflineDemotion({
    policyTier: "SHADOW",
    action: "create_order",
    deviceMode: "OFFLINE",
  }).tier === "SHADOW",
);
