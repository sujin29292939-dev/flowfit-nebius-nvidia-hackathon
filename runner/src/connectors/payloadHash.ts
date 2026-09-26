import { createHash } from "node:crypto";
import type { Capability } from "./connectorTypes.js";
import type { WorkIntent } from "./connectorResolver.js";

export type ConnectorApprovalPayloadFingerprintInput = {
  companyId: string;
  taskId: string;
  intent: WorkIntent;
  capability: Capability;
  connectorKey: string;
  payload?: Record<string, unknown>;
  proposedCall?: { method: string; baseUrl: string; path: string };
};

export const CONNECTOR_APPROVAL_PAYLOAD_HASH_VERSION = "connector-payload-v1";

export function buildConnectorApprovalPayloadHash(input: ConnectorApprovalPayloadFingerprintInput): string {
  return createHash("sha256")
    .update(buildConnectorApprovalPayloadCanonical(input))
    .digest("hex");
}

export function buildConnectorApprovalPayloadCanonical(input: ConnectorApprovalPayloadFingerprintInput): string {
  return stableStringify({
    version: CONNECTOR_APPROVAL_PAYLOAD_HASH_VERSION,
    companyId: input.companyId,
    taskId: input.taskId,
    intent: input.intent,
    capability: input.capability,
    connectorKey: input.connectorKey,
    proposedCall: input.proposedCall
      ? {
          method: input.proposedCall.method,
          baseUrl: input.proposedCall.baseUrl,
          path: input.proposedCall.path,
        }
      : null,
    payload: input.payload ?? {},
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
