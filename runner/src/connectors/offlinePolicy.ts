import { isWriteCapability, type Capability } from "./connectorTypes.js";

export type Tier = "AUTO" | "ASSIST" | "SHADOW" | "BLOCK";
export type CapabilityKind = "read" | "write";
export type DeviceOperationMode = "ONLINE" | "OFFLINE" | "RECOVERING";
export type ConnectorPath = "connector" | "device" | "generic_agent";

export interface RuleRef {
  id: string;
  serverSafeFlag: boolean;
  connectorPath: boolean;
  idempotentWrite: boolean;
  approvalCount: number;
}

export interface DemotionInput {
  policyTier: Tier;
  capability: CapabilityKind;
  deviceMode: DeviceOperationMode;
  rule: RuleRef;
}

export interface OfflineDemotionInput {
  deviceMode: DeviceOperationMode;
  capability: Capability;
  connectorPath: ConnectorPath;
  idempotencySupported?: boolean;
  serverSafeRule?: boolean;
}

export interface OfflineDemotionDecision {
  shouldDemote: boolean;
  reason: string;
}

export const SERVER_SAFE_MIN_APPROVALS = 5;

export function isServerSafeEffective(rule: RuleRef): boolean {
  return rule.serverSafeFlag
    && rule.connectorPath
    && rule.idempotentWrite
    && rule.approvalCount >= SERVER_SAFE_MIN_APPROVALS;
}

/**
 * Contract 12.2:
 * - BLOCK cannot be lifted by offline demotion.
 * - ONLINE keeps the original policy tier.
 * - read capabilities keep the original policy tier while offline.
 * - Only write + AUTO is demoted to ASSIST when server-safe conditions fail.
 * - Existing ASSIST/SHADOW decisions are not demoted further.
 */
export function applyOfflineDemotion(input: DemotionInput): Tier {
  if (input.policyTier === "BLOCK") return "BLOCK";
  if (input.deviceMode === "ONLINE") return input.policyTier;
  if (input.capability === "read") return input.policyTier;
  if (input.policyTier === "AUTO") {
    return isServerSafeEffective(input.rule) ? "AUTO" : "ASSIST";
  }
  return input.policyTier;
}

export function evaluateOfflineDemotion(input: OfflineDemotionInput): OfflineDemotionDecision {
  const after = applyOfflineDemotion({
    policyTier: "AUTO",
    capability: isWriteCapability(input.capability) ? "write" : "read",
    deviceMode: input.deviceMode,
    rule: {
      id: "inline-offline-check",
      serverSafeFlag: Boolean(input.serverSafeRule),
      connectorPath: input.connectorPath === "connector",
      idempotentWrite: Boolean(input.idempotencySupported),
      approvalCount: input.serverSafeRule ? SERVER_SAFE_MIN_APPROVALS : 0,
    },
  });

  if (after === "AUTO") {
    if (input.deviceMode === "ONLINE") return { shouldDemote: false, reason: "device_online" };
    if (!isWriteCapability(input.capability)) return { shouldDemote: false, reason: "read_capability_allowed_while_offline" };
    return { shouldDemote: false, reason: "server_safe_idempotent_connector_write" };
  }

  if (input.connectorPath !== "connector") {
    return {
      shouldDemote: true,
      reason: `${input.deviceMode.toLowerCase()}_${input.connectorPath}_write_requires_assist`,
    };
  }

  return {
    shouldDemote: true,
    reason: input.idempotencySupported
      ? `${input.deviceMode.toLowerCase()}_write_without_server_safe_rule`
      : `${input.deviceMode.toLowerCase()}_write_without_idempotency`,
  };
}
