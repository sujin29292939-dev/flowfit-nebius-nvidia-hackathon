import {
  applyOfflineDemotion,
  type CapabilityKind,
  type DeviceOperationMode,
  type Tier,
} from "../connectors/offlinePolicy.js";
import { normalizeAction } from "./actionGuard.js";

// SSOT for Generic Agent action read/write classification.
// Keep this aligned with CAPABILITY_KIND: if an action can create an
// externally observable state change, it is write. Unknown actions are write.
export const GENERIC_AGENT_READ_ACTIONS = [
  "read_inventory",
  "match_customer",
  "match_item",
  "browse_site",
  "collect_site_data",
  "open_site",
  "find_login_button",
  "focus_username_field",
  "wait_for_user_credential_input",
  "detect_login_success",
  "read_inquiry",
  "track_shipment",
  "check_payment",
] as const;

export const GENERIC_AGENT_WRITE_ACTIONS = [
  "generate_document",
  "create_order",
  "create_shipping_task",
  "send_order_confirm",
  "click_login_button",
  "update_spreadsheet",
  "create_internal_task",
  "store_encrypted_session",
  "store_session_cookie",
  "use_saved_session",
  "send_reply",
  "create_quote",
  "generate_quote",
  "handle_complaint",
  "create_report",
  "create_automation",
] as const;

const READ_ACTIONS = new Set<string>(GENERIC_AGENT_READ_ACTIONS);
const WRITE_ACTIONS = new Set<string>(GENERIC_AGENT_WRITE_ACTIONS);

export function classifyGenericAgentAction(action: string): CapabilityKind {
  const normalized = normalizeAction(action);
  if (READ_ACTIONS.has(normalized)) return "read";
  if (WRITE_ACTIONS.has(normalized)) return "write";
  return "write";
}

export function applyGenericAgentOfflineDemotion(input: {
  policyTier: Tier;
  action: string;
  deviceMode: DeviceOperationMode;
}): { tier: Tier; capability: CapabilityKind } {
  const capability = classifyGenericAgentAction(input.action);
  const tier = applyOfflineDemotion({
    policyTier: input.policyTier,
    capability,
    deviceMode: input.deviceMode,
    rule: {
      id: "generic-agent",
      serverSafeFlag: false,
      connectorPath: false,
      idempotentWrite: false,
      approvalCount: 0,
    },
  });
  return { tier, capability };
}
