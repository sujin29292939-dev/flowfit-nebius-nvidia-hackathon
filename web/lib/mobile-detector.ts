import "server-only";
import { networkInterfaces } from "node:os";

import type {
  MobileDetectorDevice,
  MobileDetectorFleetSummary,
  MobileDetectorOverview,
  MobilePairingCodeRecord,
  MobileReplyCommand,
} from "@/lib/types";

const DEFAULT_ENGINE_BASE_URL = "http://127.0.0.1:3001";
const DEFAULT_ADMIN_TOKEN = "dev-mobile-admin-token";

const adminEngineBaseUrl = normalizeBaseUrl(
  process.env.FLOWFIT_MOBILE_ENGINE_BASE_URL ??
    process.env.FLOWFIT_ENGINE_BASE_URL ??
    DEFAULT_ENGINE_BASE_URL
);

const publicEngineBaseUrl = resolvePublicEngineBaseUrl(adminEngineBaseUrl);

const mobileAdminToken =
  process.env.FLOWFIT_MOBILE_ADMIN_TOKEN ?? process.env.MOBILE_ADMIN_TOKEN ?? DEFAULT_ADMIN_TOKEN;

type DeviceListResponse = {
  devices?: MobileDetectorDevice[];
};

type PairingCodeListResponse = {
  pairing_codes?: MobilePairingCodeRecord[];
};

type DeviceControlResponse = {
  ok?: boolean;
  device?: MobileDetectorDevice;
  policy_version?: number;
  error?: string;
};

type CommandCreateResponse = {
  ok?: boolean;
  command?: MobileReplyCommand;
  error?: string;
};

type CommandListResponse = {
  commands?: MobileReplyCommand[];
};

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, "");
}

function getMobileApiBaseUrl() {
  return `${adminEngineBaseUrl}/v1/mobile`;
}

function getIpv4Priority(ipAddress: string) {
  if (ipAddress.startsWith("192.168.")) {
    return 4;
  }

  if (ipAddress.startsWith("10.")) {
    return 3;
  }

  const octets = ipAddress.split(".");
  const secondOctet = Number(octets[1] ?? "0");

  if (octets[0] === "172" && secondOctet >= 16 && secondOctet <= 31) {
    return 2;
  }

  return 1;
}

function getLanIpv4Candidates() {
  const interfaces = networkInterfaces();
  const candidates: string[] = [];

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }

      if (address.address.startsWith("169.254.")) {
        continue;
      }

      candidates.push(address.address);
    }
  }

  return candidates.sort((left, right) => getIpv4Priority(right) - getIpv4Priority(left));
}

function resolvePublicEngineBaseUrl(baseUrl: string) {
  const explicitPublicUrl =
    process.env.FLOWFIT_MOBILE_ENGINE_PUBLIC_URL ?? process.env.FLOWFIT_ENGINE_PUBLIC_URL;

  if (explicitPublicUrl) {
    return normalizeBaseUrl(explicitPublicUrl);
  }

  try {
    const url = new URL(baseUrl);

    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return normalizeBaseUrl(url.toString());
    }

    const [preferredLanIp] = getLanIpv4Candidates();
    if (!preferredLanIp) {
      return normalizeBaseUrl(url.toString());
    }

    url.hostname = preferredLanIp;
    return normalizeBaseUrl(url.toString());
  } catch {
    return normalizeBaseUrl(baseUrl);
  }
}

async function fetchMobileAdminJson<T>(pathname: string): Promise<T> {
  const response = await fetch(`${getMobileApiBaseUrl()}${pathname}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${mobileAdminToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`mobile_detector_http_${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getMobileDetectorOverview(): Promise<MobileDetectorOverview> {
  const checkedAt = new Date().toISOString();

  try {
    const [summary, devicesResponse] = await Promise.all([
      fetchMobileAdminJson<MobileDetectorFleetSummary>("/admin/fleet-summary"),
      fetchMobileAdminJson<DeviceListResponse>("/admin/devices?limit=8&offset=0"),
    ]);

    return {
      connected: true,
      checkedAt,
      engineBaseUrl: adminEngineBaseUrl,
      publicEngineBaseUrl,
      error: null,
      summary,
      devices: Array.isArray(devicesResponse.devices) ? devicesResponse.devices : [],
    };
  } catch (error) {
    return {
      connected: false,
      checkedAt,
      engineBaseUrl: adminEngineBaseUrl,
      publicEngineBaseUrl,
      error: error instanceof Error ? error.message : "mobile_detector_unavailable",
      summary: null,
      devices: [],
    };
  }
}

export async function getMobilePairingCodes(limit = 5): Promise<MobilePairingCodeRecord[]> {
  try {
    const response = await fetchMobileAdminJson<PairingCodeListResponse>(
      `/admin/pairing-codes?limit=${Math.max(1, Math.min(limit, 20))}`
    );
    return Array.isArray(response.pairing_codes) ? response.pairing_codes : [];
  } catch {
    return [];
  }
}

export async function createMobilePairingCode(input?: {
  label?: string;
  max_uses?: number;
  expires_in_hours?: number;
}): Promise<MobilePairingCodeRecord> {
  const response = await fetch(`${getMobileApiBaseUrl()}/admin/pairing-codes`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${mobileAdminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      label: input?.label ?? "FlowFit 폰 연결",
      max_uses: input?.max_uses ?? 1,
      expires_in_hours: input?.expires_in_hours ?? 24,
    }),
  });

  if (!response.ok) {
    throw new Error(`mobile_pairing_code_http_${response.status}`);
  }

  return (await response.json()) as MobilePairingCodeRecord;
}

export async function setMobileDetectorDeviceEnabled(deviceId: string, enabled: boolean) {
  const response = await fetch(
    `${getMobileApiBaseUrl()}/admin/devices/${encodeURIComponent(deviceId)}/control`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${mobileAdminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled }),
    }
  );

  const payload = (await response.json().catch(() => ({}))) as DeviceControlResponse;
  if (!response.ok || payload.ok === false || !payload.device) {
    throw new Error(payload.error ?? `mobile_device_control_http_${response.status}`);
  }

  return payload;
}

export async function getMobileReplyCommands(limit = 20, deviceId?: string) {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(limit, 100))),
  });

  if (deviceId) {
    params.set("device_id", deviceId);
  }

  const response = await fetchMobileAdminJson<CommandListResponse>(
    `/admin/commands?${params.toString()}`
  );

  return Array.isArray(response.commands) ? response.commands : [];
}

export async function createMobileReplyCommand(input: {
  deviceId?: string | null;
  replyText: string;
  sourceEventId?: string | null;
  packageName?: string | null;
  notificationKeyHash?: string | null;
  expectedSenderHint?: string | null;
  expectedBodyHint?: string | null;
  notificationTapRegion?: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  } | null;
}) {
  const replyText = input.replyText.trim();
  if (!replyText) {
    throw new Error("reply_text_required");
  }

  let deviceId = input.deviceId?.trim() || "";
  if (!deviceId) {
    const overview = await getMobileDetectorOverview();
    const preferredDevice =
      overview.devices.find((device) => device.collection_enabled !== false && !device.stale_30m) ??
      overview.devices.find((device) => device.collection_enabled !== false) ??
      overview.devices[0];

    deviceId = preferredDevice?.device_id ?? "";
  }

  if (!deviceId) {
    throw new Error("mobile_device_not_found");
  }

  const response = await fetch(
    `${getMobileApiBaseUrl()}/admin/devices/${encodeURIComponent(deviceId)}/commands`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${mobileAdminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "send_notification_reply",
        reply_text: replyText,
        source_event_id: input.sourceEventId ?? null,
        package_name: input.packageName ?? "com.kakao.talk",
        notification_key_hash: input.notificationKeyHash ?? null,
        notification_tap_region: input.notificationTapRegion ?? null,
        expected_sender_hint: input.expectedSenderHint ?? null,
        expected_body_hint: input.expectedBodyHint ?? null,
        execution_plan: ["remote_input", "visual_executor"],
        remote_input: {
          enabled: true,
          require_notification_action: true,
        },
        visual_executor: {
          enabled: true,
          requires_screen_validation: true,
          allowed_actions: ["open_notification", "focus_input", "type_reply", "send_reply"],
          stop_conditions: [
            "package_mismatch",
            "conversation_mismatch",
            "recent_message_mismatch",
            "permission_dialog",
            "low_confidence",
          ],
        },
        safety: {
          requires_pre_send_validation: true,
          min_confidence: 0.82,
          require_expected_app: true,
          require_recent_message_match: true,
        },
      }),
    }
  );

  const payload = (await response.json().catch(() => ({}))) as CommandCreateResponse;
  if (!response.ok || payload.ok === false || !payload.command) {
    throw new Error(payload.error ?? `mobile_reply_command_http_${response.status}`);
  }

  return payload.command;
}
