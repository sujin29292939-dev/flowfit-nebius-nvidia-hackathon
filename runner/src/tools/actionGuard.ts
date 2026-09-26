// tools/actionGuard.ts
// declare_action 없이 side-effect 툴을 실행하지 못하게 하는 실행 게이트.

import { randomBytes } from "node:crypto";
import type { ActionGuardDecision, ExecutionBrief } from "../agent/executionBrief.js";

const TOKEN_TTL_MS = 30_000;

const DEFAULT_BLOCKED_ACTIONS = new Set([
  "refund",
  "payment_transfer",
  "transfer_money",
  "delete_order",
  "cancel_order",
  "bulk_personal_data_export",
  "export_personal_data",
  "delete_customer_data",
  "read_password_value",
  "store_password",
  "send_credentials_to_llm",
  "bypass_captcha",
  "bypass_2fa",
]);

const DEFAULT_REQUIRED_APPROVAL_ACTIONS = new Set([
  "store_session_cookie",
  "use_saved_session",
]);

const DEFAULT_SIDE_EFFECT_TOOLS = new Set([
  "bash_exec",
  "write_file",
  "browser_navigate",
]);

export const ACTION_TOOL_MAP: Record<string, string[]> = {
  read_inventory: ["bash_exec", "read_file", "list_files"],
  match_customer: ["bash_exec", "read_file", "list_files"],
  match_item: ["bash_exec", "read_file", "list_files"],
  generate_document: ["bash_exec", "write_file", "read_file"],
  create_order: ["bash_exec", "write_file"],
  create_shipping_task: ["bash_exec", "write_file"],
  send_order_confirm: ["bash_exec", "browser_navigate"],
  browse_site: ["browser_navigate"],
  collect_site_data: ["browser_navigate"],
  update_spreadsheet: ["bash_exec", "write_file", "read_file"],
  create_internal_task: ["bash_exec", "write_file"],
  open_site: ["browser_navigate"],
  find_login_button: ["browser_navigate"],
  click_login_button: ["browser_navigate"],
  focus_username_field: ["browser_navigate"],
  wait_for_user_credential_input: ["browser_navigate"],
  detect_login_success: ["browser_navigate"],
  store_encrypted_session: ["bash_exec", "write_file"],
  store_session_cookie: ["bash_exec", "write_file"],
  use_saved_session: ["bash_exec", "browser_navigate"],
};

interface ActionToken {
  token: string;
  runId: string;
  action: string;
  reason: string;
  allowedTools: string[];
  issuedAt: number;
  usedAt?: number;
}

export class ActionGuard {
  private tokens = new Map<string, ActionToken>();

  constructor(private runId: string, private brief?: ExecutionBrief) {}

  isSideEffectTool(toolName: string): boolean {
    return DEFAULT_SIDE_EFFECT_TOOLS.has(toolName);
  }

  checkAction(action: string, reason: string): ActionGuardDecision {
    const normalized = normalizeAction(action);
    const blocked = new Set([
      ...DEFAULT_BLOCKED_ACTIONS,
      ...(this.brief?.blockedActions ?? []).map(normalizeAction),
    ]);

    if (blocked.has(normalized)) {
      return {
        decision: "blocked",
        reason: `${normalized} 행동은 이 실행에서 금지되어 있습니다. 사장/관리자 승인으로도 자동 실행하지 않습니다.`,
        allowedTools: [],
      };
    }

    const requiredApproval = new Set([
      ...DEFAULT_REQUIRED_APPROVAL_ACTIONS,
      ...(this.brief?.requiredApprovalActions ?? []).map(normalizeAction),
    ]);
    if (requiredApproval.has(normalized)) {
      return {
        decision: "approval_required",
        reason: `${normalized} 행동은 실행 전 승인이 필요합니다.`,
        allowedTools: [],
      };
    }

    const allowedActions = (this.brief?.allowedActions ?? []).map(normalizeAction);
    if (allowedActions.length > 0 && !allowedActions.includes(normalized)) {
      return {
        decision: "blocked",
        reason: `${normalized} 행동은 ExecutionBrief의 허용 행동 목록에 없습니다.`,
        allowedTools: [],
      };
    }

    const allowedTools = this.getAllowedToolsForAction(normalized);

    if (allowedTools.length === 0) {
      return {
        decision: "blocked",
        reason: `${normalized} 행동에 사용할 수 있는 허용 도구가 없습니다.`,
        allowedTools: [],
      };
    }

    return {
      decision: "allowed",
      reason: reason || `${normalized} 행동이 허용되었습니다.`,
      allowedTools,
    };
  }

  issueToken(action: string, reason: string, allowedTools: string[]): ActionToken {
    const token = `act_${randomBytes(18).toString("hex")}`;
    const record: ActionToken = {
      token,
      runId: this.runId,
      action: normalizeAction(action),
      reason,
      allowedTools,
      issuedAt: Date.now(),
    };
    this.tokens.set(token, record);
    return record;
  }

  getAllowedToolsForAction(action: string): string[] {
    const normalized = normalizeAction(action);
    const allowedActions = (this.brief?.allowedActions ?? []).map(normalizeAction);
    if (allowedActions.length > 0 && !allowedActions.includes(normalized)) return [];

    const mappedTools = ACTION_TOOL_MAP[normalized] ?? [...DEFAULT_SIDE_EFFECT_TOOLS];
    const briefTools = this.brief?.allowedTools?.length ? new Set(this.brief.allowedTools) : null;
    return briefTools ? mappedTools.filter((tool) => briefTools.has(tool)) : mappedTools;
  }

  consumeToken(toolName: string, token: unknown): { ok: true; action: string } | { ok: false; reason: string } {
    if (typeof token !== "string" || !token.startsWith("act_")) {
      return { ok: false, reason: "이 도구는 실행 전 declare_action으로 발급된 actionToken이 필요합니다." };
    }

    const record = this.tokens.get(token);
    if (!record) {
      return { ok: false, reason: "유효하지 않은 actionToken입니다." };
    }
    if (record.runId !== this.runId) {
      return { ok: false, reason: "다른 실행에서 발급된 actionToken입니다." };
    }
    if (record.usedAt) {
      return { ok: false, reason: "이미 사용된 actionToken입니다. actionToken은 1회만 사용할 수 있습니다." };
    }
    if (Date.now() - record.issuedAt > TOKEN_TTL_MS) {
      this.tokens.delete(token);
      return { ok: false, reason: "만료된 actionToken입니다. declare_action을 다시 호출하세요." };
    }
    if (!record.allowedTools.includes(toolName)) {
      return {
        ok: false,
        reason: `${record.action} actionToken으로 ${toolName} 도구를 실행할 수 없습니다.`,
      };
    }

    record.usedAt = Date.now();
    return { ok: true, action: record.action };
  }
}

export function normalizeAction(action: string): string {
  return action.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/^_+|_+$/g, "");
}
