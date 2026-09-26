import "server-only";

import type {
  BrowserAutomationAuditEntry,
  BrowserAutomationCommandPolicy,
  BrowserAutomationOverview,
} from "@/lib/types";
import { getBrowserAutomationFallbackOverview } from "@/services/browserAutomationPolicy";

const DEFAULT_ENGINE_BASE_URL = "http://127.0.0.1:3001";
const DEFAULT_ADMIN_TOKEN = "dev-mobile-admin-token";

const adminEngineBaseUrl = normalizeBaseUrl(
  process.env.FLOWFIT_BROWSER_ENGINE_BASE_URL ??
    process.env.FLOWFIT_MOBILE_ENGINE_BASE_URL ??
    process.env.FLOWFIT_ENGINE_BASE_URL ??
    DEFAULT_ENGINE_BASE_URL
);

const browserAdminToken =
  process.env.FLOWFIT_BROWSER_BRIDGE_ADMIN_TOKEN ??
  process.env.FLOWFIT_MOBILE_ADMIN_TOKEN ??
  process.env.MOBILE_ADMIN_TOKEN ??
  DEFAULT_ADMIN_TOKEN;

type BrowserBridgeOverviewResponse = {
  connected?: boolean;
  checked_at?: string;
  policy_version?: number;
  extension_token_configured?: boolean;
  sessions?: BrowserAutomationOverview["sessions"];
  command_audit?: BrowserAutomationAuditEntry[];
  policy?: BrowserAutomationOverview["policy"];
  token_saving_plan?: string[];
  recommended_sources?: BrowserAutomationOverview["recommendedSources"];
};

type BrowserBridgeCommandResponse = {
  ok?: boolean;
  command?: BrowserAutomationAuditEntry;
  error?: string;
};

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, "");
}

function getBrowserApiBaseUrl() {
  return `${adminEngineBaseUrl}/v1/browser-bridge`;
}

function normalizePolicy(policy: unknown, fallback: BrowserAutomationCommandPolicy[]) {
  if (!Array.isArray(policy)) {
    return fallback;
  }

  return policy.map((item) => {
    const raw = item as BrowserAutomationCommandPolicy & {
      risk_level?: BrowserAutomationCommandPolicy["riskLevel"];
      requires_approval?: boolean;
      token_saving_role?: string;
    };

    return {
      ...raw,
      riskLevel: raw.riskLevel ?? raw.risk_level ?? "blocked",
      requiresApproval: raw.requiresApproval ?? raw.requires_approval ?? true,
      tokenSavingRole: raw.tokenSavingRole ?? raw.token_saving_role ?? "",
    };
  });
}

async function fetchBrowserAdminJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getBrowserApiBaseUrl()}${pathname}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${browserAdminToken}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`browser_bridge_http_${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getBrowserAutomationOverview(): Promise<BrowserAutomationOverview> {
  const checkedAt = new Date().toISOString();
  const fallback = getBrowserAutomationFallbackOverview();

  try {
    const payload = await fetchBrowserAdminJson<BrowserBridgeOverviewResponse>("/admin/overview");

    return {
      connected: payload.connected === true,
      checkedAt: payload.checked_at ?? checkedAt,
      engineBaseUrl: adminEngineBaseUrl,
      error: null,
      policyVersion: payload.policy_version ?? fallback.policyVersion,
      extensionTokenConfigured: payload.extension_token_configured ?? fallback.extensionTokenConfigured,
      sessions: Array.isArray(payload.sessions) ? payload.sessions : [],
      commandAudit: Array.isArray(payload.command_audit) ? payload.command_audit : [],
      policy: normalizePolicy(payload.policy, fallback.policy),
      tokenSavingPlan: Array.isArray(payload.token_saving_plan)
        ? payload.token_saving_plan
        : fallback.tokenSavingPlan,
      recommendedSources: Array.isArray(payload.recommended_sources)
        ? payload.recommended_sources
        : fallback.recommendedSources,
    };
  } catch (error) {
    return {
      connected: false,
      checkedAt,
      engineBaseUrl: adminEngineBaseUrl,
      error: error instanceof Error ? error.message : "browser_bridge_unavailable",
      policyVersion: fallback.policyVersion,
      extensionTokenConfigured: fallback.extensionTokenConfigured,
      sessions: fallback.sessions,
      commandAudit: fallback.commandAudit,
      policy: fallback.policy,
      tokenSavingPlan: fallback.tokenSavingPlan,
      recommendedSources: fallback.recommendedSources,
    };
  }
}

export async function createBrowserBridgeCommand(input: {
  command: string;
  label?: string;
  targetUrl?: string | null;
  params?: Record<string, unknown>;
}) {
  const response = await fetchBrowserAdminJson<BrowserBridgeCommandResponse>("/admin/commands", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      command: input.command,
      label: input.label,
      target_url: input.targetUrl ?? null,
      params: input.params ?? {},
      requested_by: "owner",
    }),
  });

  if (response.ok === false || !response.command) {
    throw new Error(response.error ?? "browser_bridge_command_failed");
  }

  return response.command;
}
