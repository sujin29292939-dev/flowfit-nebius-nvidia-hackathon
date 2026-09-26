import { applyOfflineDemotion, evaluateOfflineDemotion, type RuleRef } from "./offlinePolicy.js";

function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

check(
  "ONLINE write is not demoted by offline policy",
  evaluateOfflineDemotion({
    deviceMode: "ONLINE",
    connectorPath: "connector",
    capability: "order.create",
    idempotencySupported: false,
    serverSafeRule: false,
  }).shouldDemote === false,
);

check(
  "OFFLINE read stays allowed",
  evaluateOfflineDemotion({
    deviceMode: "OFFLINE",
    connectorPath: "connector",
    capability: "inventory.read",
  }).shouldDemote === false,
);

check(
  "OFFLINE write without idempotency is demoted",
  evaluateOfflineDemotion({
    deviceMode: "OFFLINE",
    connectorPath: "connector",
    capability: "order.create",
    idempotencySupported: false,
    serverSafeRule: true,
  }).shouldDemote === true,
);

check(
  "OFFLINE write with idempotency but no server safe rule is demoted",
  evaluateOfflineDemotion({
    deviceMode: "OFFLINE",
    connectorPath: "connector",
    capability: "quote.create",
    idempotencySupported: true,
    serverSafeRule: false,
  }).shouldDemote === true,
);

check(
  "OFFLINE idempotent server-safe connector write can stay AUTO-eligible",
  evaluateOfflineDemotion({
    deviceMode: "OFFLINE",
    connectorPath: "connector",
    capability: "order.confirm",
    idempotencySupported: true,
    serverSafeRule: true,
  }).shouldDemote === false,
);

const baseRule: RuleRef = {
  id: "rule-1",
  serverSafeFlag: false,
  connectorPath: true,
  idempotentWrite: true,
  approvalCount: 0,
};

check(
  "Contract: OFFLINE write AUTO demotes to ASSIST",
  applyOfflineDemotion({
    policyTier: "AUTO",
    capability: "write",
    deviceMode: "OFFLINE",
    rule: baseRule,
  }) === "ASSIST",
);

check(
  "Contract: OFFLINE read AUTO stays AUTO",
  applyOfflineDemotion({
    policyTier: "AUTO",
    capability: "read",
    deviceMode: "OFFLINE",
    rule: baseRule,
  }) === "AUTO",
);

check(
  "Contract: BLOCK is never lifted",
  applyOfflineDemotion({
    policyTier: "BLOCK",
    capability: "write",
    deviceMode: "RECOVERING",
    rule: { ...baseRule, serverSafeFlag: true, approvalCount: 99 },
  }) === "BLOCK",
);

check(
  "Contract: SHADOW is not demoted further",
  applyOfflineDemotion({
    policyTier: "SHADOW",
    capability: "write",
    deviceMode: "OFFLINE",
    rule: baseRule,
  }) === "SHADOW",
);

check(
  "Contract: idempotent server-safe write with enough approvals stays AUTO",
  applyOfflineDemotion({
    policyTier: "AUTO",
    capability: "write",
    deviceMode: "OFFLINE",
    rule: {
      ...baseRule,
      serverSafeFlag: true,
      connectorPath: true,
      idempotentWrite: true,
      approvalCount: 5,
    },
  }) === "AUTO",
);
