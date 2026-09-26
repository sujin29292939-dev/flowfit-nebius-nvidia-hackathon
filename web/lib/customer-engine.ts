import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import {
  adminSettings,
  consentRecords,
  customerNotes,
  customers,
  DEFAULT_CUSTOMER_ID,
  eventLogs,
  helpArticles,
  integrations,
  onboardingSteps,
  orders,
  supportTickets,
  testRuns,
} from "@/lib/mock-db";
import type {
  ConsentRecord,
  Customer,
  EventLog,
  EventSeverity,
  EventStatus,
  ErrorReason,
  Integration,
  IntegrationStatus,
  IntegrationSummary,
  OnboardingStage,
  PortalStatus,
  SupportTicket,
  TestRun,
} from "@/lib/types";

const SCHEMA_VERSION = "flowfit.customer-engine.v1";
const STORE_DIR = path.join(process.cwd(), ".flowfit");
const STORE_FILE = path.join(STORE_DIR, "customer-engine-store.json");
const MANAGED_CONNECTOR_PROVIDER = "flowfit-managed" as const;
const MANAGED_CREDENTIAL_MODE = "product-managed" as const;

type Entity =
  | "customer_stage"
  | "customer_portal_status"
  | "integration_status"
  | "consent_state"
  | "test_run_status"
  | "event_log_status"
  | "ticket_status";

type TransitionLog = {
  id: string;
  schema_version: string;
  received_at: string;
  processed_at: string;
  entity_type: Entity;
  entity_id: string;
  event: string;
  from_state: string | null;
  to_state: string;
  accepted: boolean;
  actor: string;
  reason: string | null;
  metadata?: Record<string, unknown>;
};

type Store = {
  schema_version: string;
  received_at: string;
  processed_at: string;
  customers: Customer[];
  integrations: Integration[];
  consentRecords: ConsentRecord[];
  testRuns: TestRun[];
  orders: typeof orders;
  eventLogs: EventLog[];
  supportTickets: SupportTicket[];
  customerNotes: Record<string, string>;
  transition_log: TransitionLog[];
};

type ValidateKakaoInput = {
  customerId: string;
  channelName: string;
  channelId: string;
  senderProfile: string;
  accessToken?: string | null;
  actor?: string | null;
};

type RunTestInput = {
  customerId: string;
  type: TestRun["type"];
  recipient: string;
  message: string;
  actor?: string | null;
};

type ManagedConnectorMetadata = {
  connectorProvider: typeof MANAGED_CONNECTOR_PROVIDER;
  credentialMode: typeof MANAGED_CREDENTIAL_MODE;
  externalTraceId: string;
};

const stages: OnboardingStage[] = [
  "basic-info",
  "privacy-consent",
  "kakao-connected",
  "test-run",
  "active",
];

const stageProgress: Record<OnboardingStage, number> = {
  "basic-info": 12,
  "privacy-consent": 35,
  "kakao-connected": 62,
  "test-run": 78,
  active: 100,
};

const allowed: Record<Entity, Record<string, string[]>> = {
  customer_stage: {
    "basic-info": ["privacy-consent"],
    "privacy-consent": ["kakao-connected"],
    "kakao-connected": ["test-run"],
    "test-run": ["active"],
    active: [],
  },
  customer_portal_status: {
    "not-connected": ["connecting", "needs-test", "active", "error"],
    connecting: ["not-connected", "needs-test", "active", "error"],
    "needs-test": ["connecting", "active", "error"],
    active: ["needs-test", "error"],
    error: ["connecting", "needs-test", "active"],
  },
  integration_status: {
    disconnected: ["connecting", "connected", "error", "reauth-required"],
    connecting: ["connected", "error", "reauth-required"],
    connected: ["connected", "error", "reauth-required"],
    error: ["connected", "error", "reauth-required", "connecting"],
    "reauth-required": ["connected", "error", "reauth-required"],
  },
  consent_state: {
    "not-submitted": ["active"],
    "needs-renewal": ["active"],
    active: ["active", "needs-renewal"],
  },
  test_run_status: { queued: ["running"], running: ["success", "failed"], success: [], failed: [] },
  event_log_status: {
    error: ["success"],
    warning: ["success"],
    info: ["success", "warning", "error"],
    success: ["warning", "error"],
  },
  ticket_status: {
    open: ["in-progress", "on-hold", "resolved"],
    "in-progress": ["resolved", "on-hold", "open"],
    "on-hold": ["in-progress", "resolved", "open"],
    resolved: ["in-progress", "open"],
  },
};

function nowIso() {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clean(value?: string | null) {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function connectorTraceId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function withManagedConnector<T extends Record<string, unknown>>(result: T): T & ManagedConnectorMetadata {
  return {
    ...result,
    connectorProvider: MANAGED_CONNECTOR_PROVIDER,
    credentialMode: MANAGED_CREDENTIAL_MODE,
    externalTraceId: connectorTraceId("flowfit"),
  };
}

function maskToken(value?: string | null) {
  const token = clean(value);
  if (!token) return undefined;
  if (token.includes("****")) return token;
  return `${token.startsWith("kko_") ? "kko_live" : "token"}_****${token.slice(-4)}`;
}

function canMove(entity: Entity, from: string | null, to: string) {
  if (!from || from === to) return true;
  return allowed[entity]?.[from]?.includes(to) ?? false;
}

function logMove(
  store: Store,
  input: {
    entity: Entity;
    entityId: string;
    event: string;
    from: string | null;
    to: string;
    actor: string;
    reason?: string | null;
    receivedAt?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const processedAt = nowIso();
  const accepted = canMove(input.entity, input.from, input.to);
  store.transition_log.unshift({
    id: randomUUID(),
    schema_version: SCHEMA_VERSION,
    received_at: input.receivedAt ?? processedAt,
    processed_at: processedAt,
    entity_type: input.entity,
    entity_id: input.entityId,
    event: input.event,
    from_state: input.from,
    to_state: input.to,
    accepted,
    actor: input.actor,
    reason: input.reason ?? null,
    metadata: input.metadata,
  });
  if (!accepted) {
    throw new Error(`허용되지 않은 상태전이입니다: ${input.entity} ${input.from ?? "-"} -> ${input.to}`);
  }
}

async function ensureDir() {
  await fs.mkdir(STORE_DIR, { recursive: true });
}

function createSeedStore(): Store {
  const createdAt = nowIso();
  return {
    schema_version: SCHEMA_VERSION,
    received_at: createdAt,
    processed_at: createdAt,
    customers: clone(customers),
    integrations: clone(integrations),
    consentRecords: clone(consentRecords),
    testRuns: clone(testRuns),
    orders: clone(orders),
    eventLogs: clone(eventLogs),
    supportTickets: clone(supportTickets),
    customerNotes: clone(customerNotes),
    transition_log: [
      {
        id: randomUUID(),
        schema_version: SCHEMA_VERSION,
        received_at: createdAt,
        processed_at: createdAt,
        entity_type: "customer_stage",
        entity_id: DEFAULT_CUSTOMER_ID,
        event: "seed_store_initialized",
        from_state: null,
        to_state: customers[0]?.currentStage ?? "basic-info",
        accepted: true,
        actor: "system",
        reason: "초기 고객 엔진 저장소를 생성했습니다.",
      },
    ],
  };
}

function validStore(value: unknown): value is Store {
  const store = value as Store;
  return Boolean(store) && store.schema_version === SCHEMA_VERSION && Array.isArray(store.customers);
}

async function writeStore(store: Store) {
  store.processed_at = nowIso();
  await ensureDir();
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

async function readStore(): Promise<Store> {
  await ensureDir();
  try {
    const parsed = JSON.parse(await fs.readFile(STORE_FILE, "utf8")) as unknown;
    if (!validStore(parsed)) throw new Error("invalid customer engine store");
    return parsed;
  } catch {
    const seeded = createSeedStore();
    await writeStore(seeded);
    return seeded;
  }
}

function byDateDesc<T>(items: T[], pick: (item: T) => string | undefined | null) {
  return [...items].sort((a, b) => +(new Date(pick(b) ?? "")) - +(new Date(pick(a) ?? "")));
}

function getCustomer(store: Store, customerId = DEFAULT_CUSTOMER_ID) {
  return (
    store.customers.find((customer) => customer.id === customerId) ??
    store.customers.find((customer) => customer.id === DEFAULT_CUSTOMER_ID) ??
    store.customers[0]
  );
}

function customerName(store: Store, customerId: string) {
  return getCustomer(store, customerId)?.name ?? "고객";
}

function customerData(store: Store, customerId = DEFAULT_CUSTOMER_ID) {
  const customer = getCustomer(store, customerId);
  return {
    customer,
    integrations: store.integrations.filter((item) => item.customerId === customer.id),
    consent: store.consentRecords.find((item) => item.customerId === customer.id) ?? null,
    runs: store.testRuns.filter((item) => item.customerId === customer.id),
    orders: store.orders.filter((item) => item.customerId === customer.id),
    logs: store.eventLogs.filter((item) => item.customerId === customer.id),
    tickets: store.supportTickets.filter((item) => item.customerId === customer.id),
    note: store.customerNotes[customer.id] ?? "",
  };
}

function appendEvent(
  store: Store,
  input: {
    customerId: string;
    integrationType?: EventLog["integrationType"];
    eventName: string;
    severity: EventSeverity;
    status: EventStatus;
    summary: string;
    actor: string;
    retryable: boolean;
    cause?: string;
    errorCode?: string;
    requestPayload?: string;
    responsePayload?: string;
  },
) {
  const log: EventLog = {
    id: id("log"),
    customerId: input.customerId,
    customerName: customerName(store, input.customerId),
    occurredAt: nowIso(),
    integrationType: input.integrationType,
    eventName: input.eventName,
    severity: input.severity,
    status: input.status,
    summary: input.summary,
    cause: input.cause,
    errorCode: input.errorCode,
    actor: input.actor,
    retryable: input.retryable,
    requestPayload: input.requestPayload,
    responsePayload: input.responsePayload,
  };
  store.eventLogs.unshift(log);
  return log;
}

function setIntegration(
  store: Store,
  integration: Integration,
  nextStatus: IntegrationStatus,
  event: string,
  actor: string,
  receivedAt: string,
  reason?: string | null,
  metadata: Record<string, unknown> = {},
) {
  logMove(store, {
    entity: "integration_status",
    entityId: integration.id,
    event,
    from: integration.status,
    to: nextStatus,
    actor,
    reason,
    receivedAt,
    metadata: { schema_version: SCHEMA_VERSION, ...metadata },
  });
  integration.status = nextStatus;
}

function setPortal(
  store: Store,
  customer: Customer,
  nextStatus: PortalStatus,
  event: string,
  actor: string,
  receivedAt: string,
  reason: string,
) {
  if (customer.portalStatus === nextStatus) return;
  logMove(store, {
    entity: "customer_portal_status",
    entityId: customer.id,
    event,
    from: customer.portalStatus,
    to: nextStatus,
    actor,
    reason,
    receivedAt,
    metadata: { schema_version: SCHEMA_VERSION },
  });
  customer.portalStatus = nextStatus;
}

function promoteStage(
  store: Store,
  customer: Customer,
  nextStage: OnboardingStage,
  event: string,
  actor: string,
  receivedAt: string,
  reason: string,
) {
  if (stages.indexOf(nextStage) <= stages.indexOf(customer.currentStage)) return;
  let from = customer.currentStage;
  for (let index = stages.indexOf(from) + 1; index <= stages.indexOf(nextStage); index += 1) {
    const to = stages[index];
    logMove(store, {
      entity: "customer_stage",
      entityId: customer.id,
      event,
      from,
      to,
      actor,
      reason,
      receivedAt,
      metadata: { schema_version: SCHEMA_VERSION },
    });
    from = to;
  }
  customer.currentStage = nextStage;
  customer.onboardingPercent = stageProgress[nextStage];
}

function getOrCreateConsent(store: Store, customerId: string) {
  const found = store.consentRecords.find((item) => item.customerId === customerId);
  if (found) return found;
  const template = consentRecords[0];
  const record: ConsentRecord = {
    ...clone(template),
    id: id("consent"),
    customerId,
    state: "not-submitted",
    agreedAt: undefined,
    agreedBy: undefined,
    note: "필수 동의 제출 전입니다.",
    items: clone(template.items).map((item) => ({ ...item, checked: false })),
  };
  store.consentRecords.unshift(record);
  return record;
}

function getOrCreateKakao(store: Store, customerId: string) {
  const found = store.integrations.find((item) => item.customerId === customerId && item.type === "kakao");
  if (found) return found;
  const integration: Integration = {
    id: id("int-kakao"),
    customerId,
    type: "kakao",
    name: "카카오톡 채널",
    status: "disconnected",
    description: "고객 안내와 상태 알림을 카카오 메시지로 발송합니다.",
    capabilities: ["접수 알림", "상태 업데이트", "테스트 메시지"],
    callbackUrl: `http://127.0.0.1:3007/api/customer/kakao/callback/${customerId}`,
    nextAction: "채널 정보를 입력하고 연결 확인을 실행하세요.",
  };
  store.integrations.unshift(integration);
  return integration;
}

function syncCustomer(store: Store, customerId: string, event: string, actor: string, receivedAt: string) {
  const customer = getCustomer(store, customerId);
  const data = customerData(store, customer.id);
  const kakao = data.integrations.find((item) => item.type === "kakao");
  const latestRun = byDateDesc(data.runs, (item) => item.finishedAt ?? item.startedAt)[0];
  const errorLogs = data.logs.filter((log) => log.status === "error" || log.severity === "critical");

  customer.kakaoStatus = kakao?.status ?? "disconnected";
  customer.lastTestAt = latestRun?.finishedAt ?? latestRun?.startedAt ?? customer.lastTestAt;
  customer.recentErrorCount = errorLogs.length;
  customer.openTicketCount = data.tickets.filter((ticket) => ticket.status !== "resolved").length;

  if (data.consent?.state === "active") {
    promoteStage(store, customer, "privacy-consent", event, actor, receivedAt, "필수 동의가 활성 상태입니다.");
  }
  if (kakao?.status === "connected") {
    promoteStage(store, customer, "kakao-connected", event, actor, receivedAt, "카카오 연동 검증이 통과했습니다.");
  }
  if (latestRun?.status === "success") {
    promoteStage(store, customer, "active", event, actor, receivedAt, "고객 가치사슬 테스트가 완료되었습니다.");
  }

  let portalStatus: PortalStatus;
  let action: string;
  if (!data.consent || data.consent.state !== "active") {
    portalStatus = "connecting";
    action = "필수 개인정보 동의를 먼저 제출하세요.";
  } else if (!kakao || kakao.status === "disconnected") {
    portalStatus = "not-connected";
    action = "카카오 채널 정보를 입력하고 연결 테스트를 실행하세요.";
  } else if (kakao.status !== "connected") {
    portalStatus = "error";
    action = "카카오 연동 오류를 해결한 뒤 테스트를 다시 실행하세요.";
  } else if (latestRun?.status !== "success") {
    portalStatus = "needs-test";
    action = "테스트 메시지를 실행해 실제 수신 여부를 확인하세요.";
  } else {
    portalStatus = "active";
    action = "고객 입력부터 상태 확인까지 기본 흐름이 활성화되었습니다.";
  }

  setPortal(store, customer, portalStatus, event, actor, receivedAt, action);
  customer.healthStatus = portalStatus === "active" ? "healthy" : portalStatus === "error" ? "error" : "warning";
  customer.recommendedAction = action;
  customer.onboardingPercent = Math.max(customer.onboardingPercent, stageProgress[customer.currentStage]);
  return customer;
}

export async function getCustomerOnboardingData(customerId = DEFAULT_CUSTOMER_ID) {
  const store = await readStore();
  const data = customerData(store, customerId);
  return clone({
    ...data,
    steps: onboardingSteps,
    alerts: data.logs.filter((log) => log.severity === "critical" || log.severity === "warning").slice(0, 4),
  });
}

export async function getCustomerIntegrations(customerId = DEFAULT_CUSTOMER_ID) {
  const store = await readStore();
  return clone(store.integrations.filter((item) => item.customerId === customerId));
}

export async function getKakaoIntegration(customerId = DEFAULT_CUSTOMER_ID) {
  const store = await readStore();
  return clone(store.integrations.find((item) => item.customerId === customerId && item.type === "kakao") ?? null);
}

export async function getConsentRecord(customerId = DEFAULT_CUSTOMER_ID) {
  const store = await readStore();
  return clone(getOrCreateConsent(store, customerId));
}

export async function getCustomerStatusData(customerId = DEFAULT_CUSTOMER_ID) {
  const store = await readStore();
  const data = customerData(store, customerId);
  return clone({
    customer: data.customer,
    integrations: data.integrations,
    runs: byDateDesc(data.runs, (item) => item.finishedAt ?? item.startedAt),
    errors: byDateDesc(data.logs.filter((log) => log.status === "error" || log.status === "warning"), (item) => item.occurredAt),
  });
}

export async function getCustomerOrders(customerId = DEFAULT_CUSTOMER_ID) {
  const store = await readStore();
  return clone(store.orders.filter((item) => item.customerId === customerId));
}

export async function getCustomerHelpData(customerId = DEFAULT_CUSTOMER_ID) {
  const store = await readStore();
  const data = customerData(store, customerId);
  const signals = [
    data.customer.portalStatus,
    data.customer.kakaoStatus,
    ...data.integrations.flatMap((item) => [item.status, item.lastErrorCode]).filter(Boolean),
  ];
  const recommended = helpArticles.filter((article) =>
    article.relatedStatuses.some((status) =>
      signals
        .map((signal) =>
          signal === "KAKAO_TOKEN_EXPIRED"
            ? "token-expired"
            : signal === "KAKAO_SCOPE_MISSING"
              ? "insufficient-permission"
              : signal === "WEBHOOK_TIMEOUT"
                ? "connection-failed"
                : signal,
        )
        .includes(status),
    ),
  );
  return clone({
    customer: data.customer,
    recommended: recommended.length > 0 ? recommended : helpArticles.slice(0, 2),
    allArticles: helpArticles,
  });
}

export async function getAdminDashboardData() {
  const store = await readStore();
  const openTickets = store.supportTickets.filter((ticket) => ticket.status !== "resolved");
  const recentRuns = store.testRuns.filter(
    (run) => +new Date(run.startedAt) >= +new Date("2026-04-12T00:00:00+09:00"),
  );
  const successRuns = recentRuns.filter((run) => run.status === "success");
  return clone({
    kpis: {
      totalCustomers: store.customers.length,
      activeCustomers: store.customers.filter((customer) => customer.portalStatus === "active").length,
      errorCustomers: store.customers.filter((customer) => customer.healthStatus !== "healthy").length,
      successRate: recentRuns.length === 0 ? 0 : (successRuns.length / recentRuns.length) * 100,
      openTickets: openTickets.length,
    },
    distribution: [
      { label: "온보딩 전", value: store.customers.filter((item) => item.currentStage === "basic-info").length },
      { label: "동의 완료", value: store.customers.filter((item) => item.currentStage === "privacy-consent").length },
      { label: "연동 완료", value: store.customers.filter((item) => item.currentStage === "kakao-connected").length },
      { label: "테스트 완료", value: store.customers.filter((item) => item.currentStage === "test-run").length },
      { label: "활성화 완료", value: store.customers.filter((item) => item.currentStage === "active").length },
      { label: "오류", value: store.customers.filter((item) => item.healthStatus === "error").length },
    ],
    recentEvents: byDateDesc(store.eventLogs, (item) => item.occurredAt).slice(0, 6),
    recentFailures: byDateDesc(
      store.eventLogs.filter((log) => log.status === "error"),
      (item) => item.occurredAt,
    ).slice(0, 5),
    riskCustomers: [...store.customers]
      .filter((customer) => customer.recentErrorCount > 0 || customer.portalStatus === "error")
      .sort((a, b) => b.recentErrorCount - a.recentErrorCount)
      .slice(0, 5),
  });
}

export async function getAdminCustomersData() {
  const store = await readStore();
  return clone(store.customers);
}

export async function getAdminCustomerDetail(id: string) {
  const store = await readStore();
  const customer = store.customers.find((item) => item.id === id);
  if (!customer) return null;
  const data = customerData(store, id);
  return clone({
    customer,
    steps: onboardingSteps,
    integrations: data.integrations,
    consent: data.consent,
    runs: data.runs,
    logs: data.logs,
    tickets: data.tickets,
    note: data.note,
  });
}

export async function getAdminIntegrationSummary(): Promise<IntegrationSummary[]> {
  const store = await readStore();
  const summaries: Array<{ type: Integration["type"]; label: string; description: string }> = [
    { type: "kakao", label: "카카오", description: "알림톡 및 채널 메시지 운영 상태" },
    { type: "email", label: "이메일", description: "승인 메일과 리포트 전송 상태" },
    { type: "webhook", label: "접수 폼 연결", description: "기존 접수 폼과 상태 알림 수신 상태" },
  ];
  return clone(
    summaries.map((summary) => {
      const source = store.integrations.filter((item) => item.type === summary.type);
      return {
        type: summary.type,
        label: summary.label,
        description: summary.description,
        connectedCount: source.filter((item) => item.status === "connected").length,
        errorCount: source.filter((item) => item.status === "error").length,
        reauthCount: source.filter((item) => item.status === "reauth-required").length,
      };
    }),
  );
}

export async function getAdminLogs() {
  const store = await readStore();
  return clone(byDateDesc(store.eventLogs, (item) => item.occurredAt));
}

export async function getAdminEvents() {
  return getAdminLogs();
}

export async function getAdminTickets() {
  const store = await readStore();
  return clone(byDateDesc(store.supportTickets, (item) => item.lastUpdatedAt));
}

export async function getAdminSettings() {
  return clone(adminSettings);
}

function inferKakao(input: ValidateKakaoInput, integration: Integration) {
  const token = clean(input.accessToken);
  const merged = `${input.channelName} ${input.channelId} ${input.senderProfile} ${token}`.toLowerCase();
  if (!clean(input.channelName) || !clean(input.channelId) || !clean(input.senderProfile)) {
    return withManagedConnector({
      status: "error" as const,
      title: "필수값이 누락되었습니다",
      message: "채널명, 채널 ID 또는 채널 홈 주소, 발신 이름을 입력해야 연결 확인을 진행할 수 있습니다.",
      recommendedAction: "빈 항목을 채운 뒤 다시 연결 확인을 실행하세요.",
      errorCode: "MISSING_REQUIRED_FIELD",
      nextStatus: "error" as IntegrationStatus,
      integrationId: integration.id,
    });
  }
  if (token && (token.includes("****") || merged.includes("expired") || merged.includes("만료"))) {
    return withManagedConnector({
      status: "error" as const,
      title: "기존 연결 정보가 만료되었습니다",
      message: "기존 연결 정보가 만료되어 다시 연결 확인이 필요합니다.",
      recommendedAction: "채널 정보를 확인한 뒤 다시 연결 확인을 실행하세요.",
      errorCode: "KAKAO_TOKEN_EXPIRED",
      nextStatus: "reauth-required" as IntegrationStatus,
      integrationId: integration.id,
    });
  }
  if (merged.includes("scope") || merged.includes("permission") || merged.includes("권한")) {
    return withManagedConnector({
      status: "error" as const,
      title: "권한이 부족합니다",
      message: "채널 연결 권한을 확인해야 하는 상태입니다.",
      recommendedAction: "채널 관리 권한이 있는 담당자에게 확인한 뒤 다시 연결 확인을 실행하세요.",
      errorCode: "KAKAO_SCOPE_MISSING",
      nextStatus: "error" as IntegrationStatus,
      integrationId: integration.id,
    });
  }
  if (merged.includes("timeout") || merged.includes("fail") || merged.includes("실패")) {
    return withManagedConnector({
      status: "error" as const,
      title: "연결 검증에 실패했습니다",
      message: "입력값에 연결 실패 신호가 있어 검증을 중단했습니다.",
      recommendedAction: "채널 ID 또는 채널 홈 주소를 다시 확인한 뒤 재시도하세요.",
      errorCode: "KAKAO_CONNECTION_FAILED",
      nextStatus: "error" as IntegrationStatus,
      integrationId: integration.id,
    });
  }
  return withManagedConnector({
    status: "connected" as const,
    title: "연결이 확인되었습니다",
    message: "채널 정보 확인과 제품 내장 연결 점검을 통과해 카카오 연동을 활성 상태로 저장했습니다.",
    recommendedAction: "이제 테스트 메시지를 보내 실제 거래처 응대 흐름을 확인하세요.",
    errorCode: undefined,
    nextStatus: "connected" as IntegrationStatus,
    integrationId: integration.id,
  });
}

export async function validateKakaoIntegration(input: ValidateKakaoInput) {
  const store = await readStore();
  const receivedAt = nowIso();
  const actor = clean(input.actor) || "customer";
  const customer = getCustomer(store, input.customerId);
  const integration = getOrCreateKakao(store, customer.id);
  const result = inferKakao(input, integration);

  setIntegration(store, integration, result.nextStatus, "kakao_connection_validated", actor, receivedAt, result.errorCode, {
    connectorProvider: result.connectorProvider,
    credentialMode: result.credentialMode,
    externalTraceId: result.externalTraceId,
  });
  integration.channelName = clean(input.channelName);
  integration.channelId = clean(input.channelId);
  integration.senderProfile = clean(input.senderProfile);
  integration.accessTokenMasked = maskToken(input.accessToken) ?? MANAGED_CREDENTIAL_MODE;
  integration.callbackUrl = `product-managed://customer/${customer.id}/kakao`;
  integration.lastValidatedAt = nowIso();
  integration.lastErrorCode = result.errorCode;
  integration.lastErrorMessage = result.status === "connected" ? undefined : result.message;
  integration.nextAction = result.recommendedAction;

  appendEvent(store, {
    customerId: customer.id,
    integrationType: "kakao",
    eventName: result.status === "connected" ? "KakaoConnectionValidationSucceeded" : "KakaoConnectionValidationFailed",
    severity: result.status === "connected" ? "success" : "critical",
    status: result.status === "connected" ? "success" : "error",
    summary: result.message,
    cause: result.errorCode,
    errorCode: result.errorCode,
    actor,
    retryable: result.status !== "connected",
    requestPayload: JSON.stringify({
      channelId: input.channelId,
      credentialMode: result.credentialMode,
      connectorProvider: result.connectorProvider,
      schema_version: SCHEMA_VERSION,
      received_at: receivedAt,
    }),
    responsePayload: JSON.stringify({
      status: result.status,
      errorCode: result.errorCode ?? null,
      connectorProvider: result.connectorProvider,
      externalTraceId: result.externalTraceId,
      processed_at: nowIso(),
    }),
  });
  syncCustomer(store, customer.id, "kakao_connection_validated", actor, receivedAt);
  await writeStore(store);
  return clone({
    integrationId: integration.id,
    customerId: customer.id,
    checkedAt: integration.lastValidatedAt,
    status: result.status,
    title: result.title,
    message: result.message,
    recommendedAction: result.recommendedAction,
    errorCode: result.errorCode,
    connectorProvider: result.connectorProvider,
    credentialMode: result.credentialMode,
    externalTraceId: result.externalTraceId,
    integration,
  });
}

function inferTest(store: Store, input: RunTestInput) {
  const data = customerData(store, input.customerId);
  const kakao = data.integrations.find((item) => item.type === "kakao");
  const webhook = data.integrations.find((item) => item.type === "webhook");

  if (!clean(input.recipient) || !clean(input.message)) {
    return withManagedConnector({
      status: "failed" as const,
      failureReason: "missing-required-value" as ErrorReason,
      responseTimeMs: 120,
      logLines: ["요청 스키마 검증 시작", "수신 대상 또는 메시지 본문 누락", "실행 전 요청 중단"],
      retryable: true,
      eventName: "CustomerTestRunRejected",
      eventSeverity: "warning" as EventSeverity,
      eventStatus: "warning" as EventStatus,
      eventErrorCode: "MISSING_REQUIRED_FIELD",
      eventSummary: "필수 입력값이 없어 테스트 실행이 중단되었습니다.",
    });
  }

  if (input.type === "webhook-check" && webhook?.status === "error") {
    return withManagedConnector({
      status: "failed" as const,
      failureReason: "timeout" as ErrorReason,
      responseTimeMs: 10000,
      logLines: ["접수 폼 응답 확인 시작", "10초 내 응답 없음", "재시도 가능 상태로 저장"],
      retryable: true,
      eventName: "WebhookTestRunFailed",
      eventSeverity: "critical" as EventSeverity,
      eventStatus: "error" as EventStatus,
      eventErrorCode: "WEBHOOK_TIMEOUT",
      eventSummary: "접수 폼 응답 지연으로 테스트 실행이 실패했습니다.",
    });
  }

  if (input.type !== "webhook-check" && kakao?.status !== "connected") {
    return withManagedConnector({
      status: "failed" as const,
      failureReason: kakao?.lastErrorCode === "KAKAO_SCOPE_MISSING" ? "insufficient-permission" as ErrorReason : "authentication-failed" as ErrorReason,
      responseTimeMs: 980,
      logLines: ["카카오 연결 상태 확인", `현재 상태: ${kakao?.status ?? "disconnected"}`, "연결이 활성 상태가 아니라 메시지 발송을 중단"],
      retryable: true,
      eventName: "KakaoTestMessageFailed",
      eventSeverity: "critical" as EventSeverity,
      eventStatus: "error" as EventStatus,
      eventErrorCode: kakao?.lastErrorCode ?? "KAKAO_NOT_CONNECTED",
      eventSummary: "카카오 연동이 활성 상태가 아니어서 테스트 메시지가 실패했습니다.",
    });
  }

  return withManagedConnector({
    status: "success" as const,
    failureReason: undefined,
    responseTimeMs: 720 + Math.floor(Math.random() * 260),
    logLines: [
      "입력값 검증 완료",
      input.type === "webhook-check" ? "접수 폼 응답 확인 완료" : "카카오 연결 상태 확인 완료",
      "응답 수신 및 상태 저장 완료",
    ],
    retryable: false,
    eventName: input.type === "webhook-check" ? "WebhookTestRunSucceeded" : "KakaoTestMessageSucceeded",
    eventSeverity: "success" as EventSeverity,
    eventStatus: "success" as EventStatus,
    eventErrorCode: undefined,
    eventSummary: "테스트 실행이 성공했고 고객 상태가 갱신되었습니다.",
  });
}

export async function runCustomerTest(input: RunTestInput) {
  const store = await readStore();
  const receivedAt = nowIso();
  const actor = clean(input.actor) || "customer";
  const customer = getCustomer(store, input.customerId);
  const result = inferTest(store, { ...input, customerId: customer.id });
  const startedAt = nowIso();
  const finishedAt = new Date(Date.now() + result.responseTimeMs).toISOString();
  const runId = id("testrun");

  logMove(store, {
    entity: "test_run_status",
    entityId: runId,
    event: "customer_test_run_started",
    from: "queued",
    to: "running",
    actor,
    receivedAt,
    metadata: {
      type: input.type,
      schema_version: SCHEMA_VERSION,
      connectorProvider: result.connectorProvider,
      credentialMode: result.credentialMode,
      externalTraceId: result.externalTraceId,
    },
  });
  logMove(store, {
    entity: "test_run_status",
    entityId: runId,
    event: "customer_test_run_finished",
    from: "running",
    to: result.status,
    actor,
    reason: result.failureReason ?? null,
    receivedAt,
    metadata: {
      type: input.type,
      schema_version: SCHEMA_VERSION,
      connectorProvider: result.connectorProvider,
      credentialMode: result.credentialMode,
      externalTraceId: result.externalTraceId,
    },
  });

  const run: TestRun = {
    id: runId,
    customerId: customer.id,
    type: input.type,
    status: result.status,
    recipient: clean(input.recipient),
    message: clean(input.message),
    startedAt,
    finishedAt,
    responseTimeMs: result.responseTimeMs,
    logLines: result.logLines,
    failureReason: result.failureReason,
    retryable: result.retryable,
    integrationType: input.type === "webhook-check" ? "webhook" : "kakao",
  };

  store.testRuns.unshift(run);
  appendEvent(store, {
    customerId: customer.id,
    integrationType: run.integrationType,
    eventName: result.eventName,
    severity: result.eventSeverity,
    status: result.eventStatus,
    summary: result.eventSummary,
    cause: result.failureReason,
    errorCode: result.eventErrorCode,
    actor,
    retryable: result.retryable,
    requestPayload: JSON.stringify({
      type: input.type,
      recipient: input.recipient,
      connectorProvider: result.connectorProvider,
      credentialMode: result.credentialMode,
      schema_version: SCHEMA_VERSION,
      received_at: receivedAt,
    }),
    responsePayload: JSON.stringify({
      status: result.status,
      responseTimeMs: result.responseTimeMs,
      connectorProvider: result.connectorProvider,
      externalTraceId: result.externalTraceId,
      processed_at: finishedAt,
    }),
  });
  syncCustomer(store, customer.id, "customer_test_run_finished", actor, receivedAt);
  await writeStore(store);
  return clone(run);
}

export async function submitConsentUpdate(payload: {
  customerId: string;
  record: ConsentRecord;
  agreedBy: string;
}) {
  const store = await readStore();
  const receivedAt = nowIso();
  const actor = clean(payload.agreedBy) || "customer";
  const consent = getOrCreateConsent(store, payload.customerId);
  const requiredPending = payload.record.items.some((item) => item.required && !item.checked);

  if (requiredPending) {
    logMove(store, {
      entity: "consent_state",
      entityId: consent.id,
      event: "privacy_consent_rejected",
      from: consent.state,
      to: consent.state,
      actor,
      reason: "필수 동의 항목이 누락되었습니다.",
      receivedAt,
      metadata: { schema_version: SCHEMA_VERSION },
    });
    await writeStore(store);
    throw new Error("필수 동의 항목을 모두 체크해야 제출할 수 있습니다.");
  }

  logMove(store, {
    entity: "consent_state",
    entityId: consent.id,
    event: "privacy_consent_submitted",
    from: consent.state,
    to: "active",
    actor,
    reason: "필수 동의 항목이 모두 제출되었습니다.",
    receivedAt,
    metadata: { version: payload.record.version, schema_version: SCHEMA_VERSION },
  });
  consent.items = clone(payload.record.items);
  consent.version = payload.record.version;
  consent.state = "active";
  consent.agreedAt = nowIso();
  consent.agreedBy = actor;
  consent.note = "동의 기록이 실제 고객 엔진 저장소에 저장되었습니다.";

  appendEvent(store, {
    customerId: consent.customerId,
    eventName: "PrivacyConsentCompleted",
    severity: "success",
    status: "success",
    summary: `개인정보 동의가 ${consent.version} 버전으로 제출되었습니다.`,
    actor,
    retryable: false,
    requestPayload: JSON.stringify({ version: consent.version, schema_version: SCHEMA_VERSION, received_at: receivedAt }),
    responsePayload: JSON.stringify({ state: consent.state, processed_at: consent.agreedAt }),
  });
  syncCustomer(store, consent.customerId, "privacy_consent_submitted", actor, receivedAt);
  await writeStore(store);
  return clone(consent);
}

export async function retryEventLog(logId: string) {
  const store = await readStore();
  const target = store.eventLogs.find((item) => item.id === logId);
  if (!target) return null;

  const receivedAt = nowIso();
  logMove(store, {
    entity: "event_log_status",
    entityId: target.id,
    event: "event_log_retry_completed",
    from: target.status,
    to: "success",
    actor: "admin",
    reason: "수동 재시도 완료",
    receivedAt,
    metadata: { schema_version: SCHEMA_VERSION },
  });
  target.occurredAt = nowIso();
  target.severity = "success";
  target.status = "success";
  target.summary = `${target.eventName} 재시도가 성공했습니다.`;
  target.cause = "수동 재시도 완료";
  target.errorCode = undefined;
  target.retryable = false;
  target.responsePayload = JSON.stringify({ status: 200, message: "retry ok", schema_version: SCHEMA_VERSION, processed_at: target.occurredAt });

  if (target.customerId) syncCustomer(store, target.customerId, "event_log_retry_completed", "admin", receivedAt);
  await writeStore(store);
  return clone(target);
}

export async function assignTicket(ticketId: string, assignee: string) {
  const store = await readStore();
  const ticket = store.supportTickets.find((item) => item.id === ticketId);
  if (!ticket) return null;

  const receivedAt = nowIso();
  logMove(store, {
    entity: "ticket_status",
    entityId: ticket.id,
    event: "ticket_assigned",
    from: ticket.status,
    to: "in-progress",
    actor: "admin",
    reason: `${assignee} 담당자 배정`,
    receivedAt,
    metadata: { assignee, schema_version: SCHEMA_VERSION },
  });
  ticket.assignedTo = clean(assignee) || "담당자";
  ticket.status = "in-progress";
  ticket.lastUpdatedAt = nowIso();
  ticket.updates = [...ticket.updates, `${ticket.assignedTo}에게 담당자가 배정되었습니다.`];
  syncCustomer(store, ticket.customerId, "ticket_assigned", "admin", receivedAt);
  await writeStore(store);
  return clone(ticket);
}

export async function searchCustomer(customerId: string): Promise<Customer | null> {
  const store = await readStore();
  return clone(store.customers.find((item) => item.id === customerId) ?? null);
}

export async function getCustomerEngineContract() {
  const store = await readStore();
  return clone({
    schema_version: store.schema_version,
    received_at: store.received_at,
    processed_at: store.processed_at,
    connector_provider: MANAGED_CONNECTOR_PROVIDER,
    credential_mode: MANAGED_CREDENTIAL_MODE,
    transition_log: store.transition_log.slice(0, 50),
  });
}
