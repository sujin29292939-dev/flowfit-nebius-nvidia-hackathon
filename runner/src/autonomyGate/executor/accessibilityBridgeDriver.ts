import type { ScreenDriver, ScreenObservation } from "./types.js";

export type AccessibilityBridgeKind = "android_accessibility" | "openclaw";

export interface AccessibilityBridgeConfig {
  kind: AccessibilityBridgeKind;
  baseUrl: string;
  apiKey?: string;
  deviceId?: string;
  pathPrefix?: string;
  timeoutMs?: number;
}

type BridgeObservation = Partial<ScreenObservation> & {
  packageName?: unknown;
  foreground_package?: unknown;
  visible_sender?: unknown;
  visible_recent_body?: unknown;
  has_reply_field?: unknown;
  has_send_button?: unknown;
  recognition_confidence?: unknown;
  candidate_targets?: unknown;
};

type BridgeOk = {
  ok?: unknown;
  success?: unknown;
  status?: unknown;
};

export class AccessibilityBridgeDriver implements ScreenDriver {
  constructor(private config: AccessibilityBridgeConfig) {}

  async observe(): Promise<ScreenObservation> {
    const raw = await this.request<BridgeObservation>("observe", { deviceId: this.config.deviceId });
    return {
      foregroundPackage: asString(raw.foregroundPackage ?? raw.foreground_package ?? raw.packageName, ""),
      visibleSender: nullableString(raw.visibleSender ?? raw.visible_sender),
      visibleRecentBody: nullableString(raw.visibleRecentBody ?? raw.visible_recent_body),
      hasReplyField: asBoolean(raw.hasReplyField ?? raw.has_reply_field, false),
      hasSendButton: asBoolean(raw.hasSendButton ?? raw.has_send_button, false),
      recognitionConfidence: clamp01(asNumber(raw.recognitionConfidence ?? raw.recognition_confidence, 0)),
      candidateTargets: Math.max(0, Math.floor(asNumber(raw.candidateTargets ?? raw.candidate_targets, 0))),
    };
  }

  async inputText(text: string): Promise<boolean> {
    const raw = await this.request<BridgeOk>("input-text", { deviceId: this.config.deviceId, text });
    return bridgeOk(raw);
  }

  async tapSend(): Promise<boolean> {
    const raw = await this.request<BridgeOk>("tap-send", { deviceId: this.config.deviceId });
    return bridgeOk(raw);
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);
    try {
      const response = await fetch(joinUrl(this.config.baseUrl, this.config.pathPrefix, path), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`${this.config.kind}_${path}_failed:${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }
}

function joinUrl(baseUrl: string, prefix: string | undefined, path: string): string {
  const parts = [baseUrl, prefix, path]
    .filter((part): part is string => Boolean(part))
    .map((part, index) => (index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, "")));
  return parts.join("/");
}

function bridgeOk(raw: BridgeOk): boolean {
  if (typeof raw.ok !== "undefined") return asBoolean(raw.ok, false);
  if (typeof raw.success !== "undefined") return asBoolean(raw.success, false);
  if (typeof raw.status === "string") {
    return ["ok", "success", "succeeded", "sent", "done"].includes(raw.status.toLowerCase());
  }
  return false;
}

function nullableString(value: unknown): string | null {
  if (value === null || typeof value === "undefined") return null;
  return asString(value, null);
}

function asString(value: unknown, fallback: string): string;
function asString(value: unknown, fallback: null): string | null;
function asString(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["true", "1", "yes", "ok", "success", "succeeded"].includes(normalized)) return true;
    if (["false", "0", "no", "failed", "error"].includes(normalized)) return false;
  }
  return fallback;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
