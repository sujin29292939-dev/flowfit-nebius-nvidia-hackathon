import { AutonomyGate } from "./autonomyGate.js";
import { CriteriaRegistry, type AutoCriterion } from "./criteriaRegistry.js";
import { DispatchQueue, MemoryEventSink } from "./dispatchQueue.js";
import { buildDispatchPayload } from "./dispatchPayload.js";
import { fromCreateInput } from "./adapters.js";
import { ShadowLog } from "./shadowLog.js";
import { DEFAULT_CONFIG, type GateConfig, type GateMode, type GateResult, type RiskLevel } from "./types.js";
import {
  MemoryNotifyEngine,
  MemoryStaffSender,
  NotifyTransport,
  type NotifyEngineClient,
  type StaffChannelSender,
  type StaffRequestChannel,
} from "./notifyTransport.js";
import { GmailSender } from "./connect/email/gmailSender.js";
import { OutlookSender } from "./connect/email/outlookSender.js";
import { KakaoworkSender } from "./connect/kakaowork/kakaoworkClient.js";
import { SlackSender, type TokenResolver } from "./connect/slack/slackVerifier.js";
import { WebhookSender } from "./connect/webhook/webhookSender.js";
import { AccessibilityBridgeDriver, type AccessibilityBridgeKind } from "./executor/accessibilityBridgeDriver.js";
import { ExecutorNotifyEngine } from "./executor/mockDriver.js";
import { ScreenExecutor } from "./executor/screenExecutor.js";
import {
  StaffChannelRouter,
  type StaffChannelRoute,
  type StaffChannelRouteBook,
  type StaffChannelSenders,
} from "./staffChannelRouter.js";
import type { CreateApprovalRequestInput } from "../approvals/types.js";

type ApprovalGateInput = CreateApprovalRequestInput & {
  riskLevel?: RiskLevel;
  approvalPolicy?: "owner_only" | "approval_required";
};

type ExecutorRuntime =
  | { driver: "memory"; enabled: false; reason?: string }
  | {
      driver: AccessibilityBridgeKind;
      enabled: true;
      baseUrl: string;
      apiKey?: string;
      deviceId?: string;
      pathPrefix?: string;
      timeoutMs: number;
    }
  | { driver: AccessibilityBridgeKind; enabled: false; reason: string };

type StaffRouterRuntime = {
  sender: StaffChannelSender;
  fallback: MemoryStaffSender;
  enabled: boolean;
  routeCount: number;
  channels: StaffRequestChannel[];
  defaultOrder: StaffRequestChannel[];
  errors: string[];
};

const config = loadConfig();
const registry = new CriteriaRegistry();
const events = new MemoryEventSink();
const shadow = new ShadowLog();
const executorRuntime = loadExecutorRuntime();
const notifyEngine = createNotifyEngine(executorRuntime);
const staffRouterRuntime = createStaffRouterRuntime();
const staffSender = staffRouterRuntime.sender;
const transport = new NotifyTransport(config, notifyEngine, staffSender, events);
const queue = new DispatchQueue(transport, events, config.dispatchDelayMs);
const gate = new AutonomyGate({ config, registry, queue, shadow, buildDispatchPayload });

let dispatchLoop: NodeJS.Timeout | null = null;

seedDefaultCriteria();

export async function runAutonomyGateForCreateInput(input: ApprovalGateInput): Promise<GateResult> {
  return gate.run(fromCreateInput(input));
}

export function upsertAutonomyCriterion(input: {
  criterionId: string;
  criterionTitle: string;
  autoAllowed: boolean;
  keywords: string[];
  actionType?: string;
}): AutoCriterion {
  registry.upsertFromCard(input);
  const criterion = registry.list().find((item) => item.criterionId === input.criterionId);
  if (!criterion) throw new Error(`Autonomy criterion was not saved: ${input.criterionId}`);
  return criterion;
}

export function listAutonomyCriteria(): AutoCriterion[] {
  return registry.list();
}

export function getAutonomyGateSnapshot() {
  return {
    config,
    executor: publicExecutorRuntime(),
    criteria: registry.list(),
    pendingDispatches: queue.pending(),
    events: events.events.slice(-100),
    notifyCommands: notifyEngine instanceof MemoryNotifyEngine ? notifyEngine.commands.slice(-100) : [],
    staffRequests: staffRouterRuntime.fallback.requests.slice(-100),
    staffRouter: publicStaffRouterRuntime(),
    shadowReport: shadow.report(),
  };
}

export function startAutonomyGateDispatchLoop(intervalMs = 5_000): () => void {
  if (dispatchLoop) return () => undefined;
  dispatchLoop = setInterval(() => {
    void queue.flush().catch((error) => {
      events.emit("dispatch.loop_failed", { error: String(error) });
    });
  }, intervalMs);

  return () => {
    if (!dispatchLoop) return;
    clearInterval(dispatchLoop);
    dispatchLoop = null;
  };
}

function createNotifyEngine(runtime: ExecutorRuntime): NotifyEngineClient {
  if (!runtime.enabled) {
    return new MemoryNotifyEngine();
  }
  const driver = new AccessibilityBridgeDriver({
    kind: runtime.driver,
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey,
    deviceId: runtime.deviceId,
    pathPrefix: runtime.pathPrefix,
    timeoutMs: runtime.timeoutMs,
  });
  const executor = new ScreenExecutor(driver, events);
  return new ExecutorNotifyEngine(executor, events);
}

function createStaffRouterRuntime(): StaffRouterRuntime {
  const fallback = new MemoryStaffSender();
  const tokenResolver: TokenResolver = { resolve: resolveEnvCredential };
  const routes = loadStaffRoutes();
  const defaultOrder = loadStaffChannelOrder();
  const senders: StaffChannelSenders = {
    slack: new SlackSender(tokenResolver),
    kakaowork: new KakaoworkSender(tokenResolver),
    webhook: new WebhookSender(tokenResolver),
    gmail: new GmailSender(staticAccessTokenProvider("GMAIL_ACCESS_TOKEN")),
    outlook: new OutlookSender(staticAccessTokenProvider("OUTLOOK_ACCESS_TOKEN")),
    sms: fallback,
    telegram: fallback,
    manual: fallback,
  };
  const routeBook = createRuntimeStaffRouteBook(routes.routes);
  return {
    sender: new StaffChannelRouter({ senders, routeBook, defaultChannelOrder: defaultOrder }),
    fallback,
    enabled: routes.routes.length > 0,
    routeCount: routes.routes.length,
    channels: Array.from(new Set(routes.routes.map((route) => route.channel))).sort(),
    defaultOrder,
    errors: routes.errors,
  };
}

function publicExecutorRuntime() {
  if (!executorRuntime.enabled) return executorRuntime;
  return {
    driver: executorRuntime.driver,
    enabled: true,
    baseUrl: sanitizeUrl(executorRuntime.baseUrl),
    deviceId: executorRuntime.deviceId ?? null,
    pathPrefix: executorRuntime.pathPrefix ?? null,
    timeoutMs: executorRuntime.timeoutMs,
  };
}

function publicStaffRouterRuntime() {
  return {
    enabled: staffRouterRuntime.enabled,
    routeCount: staffRouterRuntime.routeCount,
    channels: staffRouterRuntime.channels,
    defaultOrder: staffRouterRuntime.defaultOrder,
    fallback: "manual_memory",
    errors: staffRouterRuntime.errors,
  };
}

function loadExecutorRuntime(): ExecutorRuntime {
  const driver = normalizeDriver(process.env.AUTONOMY_EXECUTOR_DRIVER);
  if (driver === "memory") return { driver: "memory", enabled: false, reason: "memory_notify_engine" };

  const baseUrl =
    driver === "openclaw"
      ? firstNonEmpty(
          process.env.OPENCLAW_ACCESSIBILITY_BRIDGE_URL,
          process.env.OPENCLAW_GATEWAY_URL,
          process.env.AUTONOMY_ACCESSIBILITY_BRIDGE_URL,
        )
      : firstNonEmpty(
          process.env.ANDROID_ACCESSIBILITY_BRIDGE_URL,
          process.env.AUTONOMY_ACCESSIBILITY_BRIDGE_URL,
        );

  if (!baseUrl) return { driver, enabled: false, reason: "missing_bridge_url" };

  return {
    driver,
    enabled: true,
    baseUrl,
    apiKey:
      driver === "openclaw"
        ? firstNonEmpty(process.env.OPENCLAW_ACCESSIBILITY_API_KEY, process.env.ACCESSIBILITY_BRIDGE_API_KEY)
        : firstNonEmpty(process.env.ANDROID_ACCESSIBILITY_API_KEY, process.env.ACCESSIBILITY_BRIDGE_API_KEY),
    deviceId:
      driver === "openclaw"
        ? firstNonEmpty(process.env.OPENCLAW_ANDROID_DEVICE_ID, process.env.ACCESSIBILITY_BRIDGE_DEVICE_ID)
        : firstNonEmpty(process.env.ANDROID_ACCESSIBILITY_DEVICE_ID, process.env.ACCESSIBILITY_BRIDGE_DEVICE_ID),
    pathPrefix: firstNonEmpty(
      process.env.ACCESSIBILITY_BRIDGE_PATH_PREFIX,
      driver === "openclaw" ? process.env.OPENCLAW_ACCESSIBILITY_PATH_PREFIX : process.env.ANDROID_ACCESSIBILITY_PATH_PREFIX,
    ),
    timeoutMs: parseNumber(process.env.ACCESSIBILITY_BRIDGE_TIMEOUT_MS, 10_000),
  };
}

function normalizeDriver(value: string | undefined): ExecutorRuntime["driver"] {
  const normalized = (value ?? "memory").toLowerCase();
  if (normalized === "android" || normalized === "android_accessibility") return "android_accessibility";
  if (normalized === "openclaw") return "openclaw";
  return "memory";
}

function createRuntimeStaffRouteBook(routes: StaffChannelRoute[]): StaffChannelRouteBook {
  return {
    routesFor(companyId: string): StaffChannelRoute[] {
      const matched = routes.filter((route) => route.companyId === companyId);
      return [
        ...matched,
        {
          id: `fallback:${companyId}:manual`,
          companyId,
          channel: "manual",
          priority: 1_000,
          enabled: true,
        },
      ];
    },
  };
}

function resolveEnvCredential(credentialRef: string): string | null {
  const key = credentialRef.startsWith("env:") ? credentialRef.slice(4) : credentialRef;
  if (!/^[A-Z0-9_]+$/.test(key)) return null;
  return firstNonEmpty(process.env[key]) ?? null;
}

function staticAccessTokenProvider(envName: string) {
  return async () => firstNonEmpty(process.env[envName]) ?? null;
}

function loadStaffRoutes(): { routes: StaffChannelRoute[]; errors: string[] } {
  const routes: StaffChannelRoute[] = [];
  const errors: string[] = [];
  const raw = firstNonEmpty(process.env.STAFF_CHANNEL_ROUTES_JSON);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const route = normalizeStaffRoute(item);
          if (route) routes.push(route);
        }
      } else {
        errors.push("STAFF_CHANNEL_ROUTES_JSON must be an array");
      }
    } catch (error) {
      errors.push(`STAFF_CHANNEL_ROUTES_JSON parse failed: ${String(error)}`);
    }
  }

  const defaultChannel = firstNonEmpty(process.env.STAFF_CHANNEL_DEFAULT_CHANNEL);
  if (defaultChannel) {
    routes.push({
      id: "env:default-staff-route",
      companyId: firstNonEmpty(process.env.STAFF_CHANNEL_COMPANY_ID, process.env.DEFAULT_COMPANY_ID) ?? "company_demo",
      channel: defaultChannel as StaffRequestChannel,
      credentialRef: firstNonEmpty(process.env.STAFF_CHANNEL_CREDENTIAL_REF),
      target: firstNonEmpty(process.env.STAFF_CHANNEL_TARGET),
      priority: parseNumber(process.env.STAFF_CHANNEL_PRIORITY, 10),
      enabled: parseBoolean(process.env.STAFF_CHANNEL_ENABLED, true),
      meta: parseJsonObject(process.env.STAFF_CHANNEL_ROUTE_META_JSON, errors),
    });
  }

  return { routes, errors };
}

function normalizeStaffRoute(input: unknown): StaffChannelRoute | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const id = stringValue(record.id);
  const companyId = stringValue(record.companyId);
  const channel = stringValue(record.channel);
  if (!id || !companyId || !channel) return null;
  return {
    id,
    companyId,
    channel: channel as StaffRequestChannel,
    credentialRef: stringValue(record.credentialRef),
    target: stringValue(record.target),
    priority: typeof record.priority === "number" ? record.priority : 100,
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    meta: objectValue(record.meta),
  };
}

function loadStaffChannelOrder(): StaffRequestChannel[] {
  const raw = firstNonEmpty(process.env.STAFF_CHANNEL_DEFAULT_ORDER);
  const fallback: StaffRequestChannel[] = ["slack", "teams", "kakao_work", "email", "webhook", "sms", "telegram", "manual"];
  if (!raw) return fallback;
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as StaffRequestChannel[];
  return parsed.length > 0 ? parsed : fallback;
}

function parseJsonObject(value: string | undefined, errors: string[]): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return objectValue(JSON.parse(value));
  } catch (error) {
    errors.push(`STAFF_CHANNEL_ROUTE_META_JSON parse failed: ${String(error)}`);
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function loadConfig(): GateConfig {
  const mode = parseGateMode(process.env.AUTONOMY_GATE_MODE) ?? DEFAULT_CONFIG.mode;
  const confidenceThreshold = parseNumber(
    process.env.AUTONOMY_GATE_CONFIDENCE_THRESHOLD,
    DEFAULT_CONFIG.confidenceThreshold,
  );
  const dispatchDelayMs = parseNumber(
    process.env.AUTONOMY_GATE_DISPATCH_DELAY_MS,
    DEFAULT_CONFIG.dispatchDelayMs,
  );
  const perRecipientDailyLimit = parseNumber(
    process.env.AUTONOMY_GATE_DAILY_LIMIT,
    DEFAULT_CONFIG.perRecipientDailyLimit,
  );

  return {
    ...DEFAULT_CONFIG,
    mode,
    confidenceThreshold,
    dispatchDelayMs,
    perRecipientDailyLimit,
    killSwitch: parseBoolean(process.env.AUTONOMY_GATE_KILL_SWITCH, DEFAULT_CONFIG.killSwitch),
  };
}

function parseGateMode(value: string | undefined): GateMode | undefined {
  if (value === "SHADOW" || value === "ASSIST" || value === "AUTO") return value;
  return undefined;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/[?#].*$/, "");
  }
}

function seedDefaultCriteria(): void {
  const seeds: AutoCriterion[] = [
    {
      criterionId: "internal-classification",
      title: "\uB0B4\uBD80 \uBD84\uB958",
      autoAllowed: true,
      keywords: ["\uB0B4\uBD80 \uBD84\uB958", "\uBD84\uB958", "\uD0DC\uADF8", "\uC815\uB9AC"],
      actionType: "internal_classification",
    },
    {
      criterionId: "internal-record-save",
      title: "\uB0B4\uBD80 \uAE30\uB85D \uC800\uC7A5",
      autoAllowed: true,
      keywords: [
        "\uB0B4\uBD80 \uAE30\uB85D",
        "\uAE30\uB85D \uC800\uC7A5",
        "\uC0C1\uD0DC \uC5C5\uB370\uC774\uD2B8",
        "\uD0DC\uADF8 \uC815\uB9AC",
        "\uCC98\uB9AC \uACB0\uACFC \uC800\uC7A5",
      ],
      actionType: "internal_record_save",
    },
    {
      criterionId: "recurring-reminder",
      title: "\uBC18\uBCF5 \uC54C\uB9BC \uC0DD\uC131",
      autoAllowed: true,
      keywords: [
        "\uBC18\uBCF5 \uC54C\uB9BC",
        "\uC7AC\uC54C\uB9BC",
        "\uB9AC\uB9C8\uC778\uB4DC",
        "\uC77C\uC815 \uC54C\uB9BC",
      ],
      actionType: "recurring_reminder",
    },
    {
      criterionId: "low-risk-report-draft",
      title: "\uB0AE\uC740 \uC704\uD5D8\uB3C4 \uBCF4\uACE0\uC11C \uCD08\uC548",
      autoAllowed: true,
      keywords: [
        "\uBCF4\uACE0\uC11C \uCD08\uC548",
        "\uC694\uC57D \uBCF4\uACE0",
        "\uB300\uD45C \uBCF4\uACE0",
        "\uB0B4\uBD80 \uBCF4\uACE0",
      ],
      actionType: "low_risk_report_draft",
    },
    {
      criterionId: "general-inquiry-classification",
      title: "\uC77C\uBC18 \uBB38\uC758 \uBD84\uB958",
      autoAllowed: true,
      keywords: [
        "\uC77C\uBC18 \uBB38\uC758",
        "\uBB38\uC758 \uBD84\uB958",
        "\uBC30\uC1A1 \uBB38\uC758",
        "\uC8FC\uBB38 \uBCC0\uACBD",
      ],
      actionType: "general_inquiry_classification",
    },
  ];

  for (const seed of seeds) {
    registry.upsert(seed);
  }
}
