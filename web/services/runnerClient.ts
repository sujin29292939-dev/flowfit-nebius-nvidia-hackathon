export type RunnerPriority = "high" | "normal" | "low";

export type RunnerStartResponse = {
  runId: string;
  status: "running" | "pending";
  position?: number;
  streamUrl: string;
  statusUrl: string;
  queueUrl: string;
  queueStats?: RunnerQueueStats;
};

export type RunnerQueueStats = {
  running: number;
  pending: number;
  maxConcurrent: number;
  slotsAvailable: number;
};

export type RunnerStatusResponse = {
  runId: string;
  eventCount: number;
  events: unknown[];
};

export type RunnerApprovalListResponse = {
  count: number;
  approvals: unknown[];
  aiWorkItems: unknown[];
};

export type RunnerIntakeListResponse = {
  count: number;
  intakes: unknown[];
};

export type RunnerTaskListResponse = {
  count: number;
  tasks: unknown[];
};

export type RunnerTaskActionResponse = Record<string, unknown>;

export type RunnerTaskTimelineResponse = {
  taskId: string;
  task?: unknown;
  count: number;
  items: unknown[];
};

export type RunnerCollectAndUnderstandResponse = {
  intake: unknown;
  understanding?: unknown;
  task?: unknown;
  duplicate?: boolean;
};

export type RunnerUnderstandResponse = {
  understanding: unknown;
};

export type RunnerChatResponse = {
  reply: string;
  engine: string;
  provider: string;
};

export type RunnerAiRuntimeResponse = {
  status: "live" | "configured" | "not_configured";
  configuredProvider: string;
  configuredModel: string;
  provider: string;
  model: string;
  route: string | null;
  latencyMs: number | null;
  lastSuccessAt: string | null;
  successCount: number;
  prototype: boolean;
};

export type RunnerChatWorkResponse = {
  duplicate: boolean;
  intakeId?: string;
  taskId?: string | null;
  understanding?: unknown;
  context?: unknown;
  decision?: unknown;
  approval?: unknown;
  intake?: unknown;
};

export type RunnerChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RunnerAutonomyCriterionInput = {
  criterionId: string;
  criterionTitle: string;
  autoAllowed: boolean;
  keywords: string[];
  actionType?: string;
};

export type RunnerProvisionStep = {
  id:
    | "token_validate"
    | "tenant_provision"
    | "plan_apply"
    | "device_pair"
    | "policy_sync"
    | "ready";
  label: string;
  status: "pending" | "running" | "done" | "failed";
  message: string;
};

export type RunnerProvisionResponse = {
  sessionId: string;
  companyId: string;
  plan: string;
  ready: boolean;
  pairingCode: string;
  pairingCodeExpiresAt: string | null;
  policySnapshot?: unknown;
  steps: RunnerProvisionStep[];
};

export class RunnerConfigError extends Error {
  constructor(message = "FlowFit Runner 설정이 없습니다.") {
    super(message);
    this.name = "RunnerConfigError";
  }
}

function getRunnerConfig() {
  const baseUrl = process.env.FLOWFIT_RUNNER_URL ?? process.env.RUNNER_URL ?? "http://127.0.0.1:3001";
  const apiKey = process.env.FLOWFIT_RUNNER_API_KEY ?? process.env.RUNNER_API_KEY ?? "";

  if (!apiKey) {
    throw new RunnerConfigError("FLOWFIT_RUNNER_API_KEY 또는 RUNNER_API_KEY가 필요합니다.");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
  };
}

function buildRunnerUrl(path: string) {
  const { baseUrl } = getRunnerConfig();
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function runnerFetch(path: string, init: RequestInit = {}) {
  const { apiKey } = getRunnerConfig();
  return fetch(buildRunnerUrl(path), {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

export async function startRunnerRun(input: { task: string; priority?: RunnerPriority; executionBrief?: unknown }) {
  const response = await runnerFetch("/run", {
    method: "POST",
    body: JSON.stringify({
      task: input.task,
      priority: input.priority ?? "normal",
      ...(input.executionBrief ? { executionBrief: input.executionBrief } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner 요청 실패: ${response.status}`);
  }

  return (await response.json()) as RunnerStartResponse;
}

export async function getRunnerQueue() {
  const response = await runnerFetch("/queue");
  if (!response.ok) {
    throw new Error(`Runner 큐 조회 실패: ${response.status}`);
  }
  return (await response.json()) as RunnerQueueStats;
}

export async function getRunnerAiRuntime() {
  const response = await runnerFetch("/runtime/ai");
  if (!response.ok) {
    throw new Error(`Runner AI runtime 조회 실패: ${response.status}`);
  }
  return (await response.json()) as RunnerAiRuntimeResponse;
}

export async function getRunnerIntakes() {
  const response = await runnerFetch("/intakes");
  if (!response.ok) {
    throw new Error(`Runner intake 조회 실패: ${response.status}`);
  }
  return (await response.json()) as RunnerIntakeListResponse;
}

export async function getRunnerTasks() {
  const response = await runnerFetch("/tasks");
  if (!response.ok) {
    throw new Error(`Runner task 조회 실패: ${response.status}`);
  }
  return (await response.json()) as RunnerTaskListResponse;
}

export async function executeRunnerTask(taskId: string) {
  const response = await runnerFetch(`/tasks/${encodeURIComponent(taskId)}/execute`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner task execute failed: ${response.status}`);
  }
  return (await response.json()) as RunnerTaskActionResponse;
}

export async function decideRunnerTask(taskId: string) {
  const response = await runnerFetch(`/tasks/${encodeURIComponent(taskId)}/decide`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner task decision failed: ${response.status}`);
  }
  return (await response.json()) as RunnerTaskActionResponse;
}

export async function getRunnerTaskTimeline(taskId: string) {
  const response = await runnerFetch(`/tasks/${encodeURIComponent(taskId)}/timeline`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner task timeline failed: ${response.status}`);
  }
  return (await response.json()) as RunnerTaskTimelineResponse;
}

export async function collectRunnerSiteIntake(input: { text: string; sourceName?: string; title?: string }) {
  const response = await runnerFetch("/intakes/site", {
    method: "POST",
    body: JSON.stringify({
      text: input.text,
      title: input.title ?? "FlowFit UI 수동 수집",
      sourceName: input.sourceName ?? "flowfit_workspace",
      url: "flowfit://workspace/manual-intake",
      syncUnderstanding: true,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner 수집 실패: ${response.status}`);
  }
  const intake = (await response.json()) as Record<string, unknown>;
  const intakeId = typeof intake.id === "string" ? intake.id : "";

  if (!intakeId) {
    return { intake } satisfies RunnerCollectAndUnderstandResponse;
  }

  const understandingResponse = await runnerFetch(`/intakes/${encodeURIComponent(intakeId)}/understand`, {
    method: "POST",
  });

  if (!understandingResponse.ok) {
    const body = await understandingResponse.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner AI 분류 실패: ${understandingResponse.status}`);
  }

  const result = (await understandingResponse.json()) as Record<string, unknown>;
  return {
    intake,
    understanding: result.understanding,
    task: result.task,
    duplicate: Boolean(intake.duplicate),
  } satisfies RunnerCollectAndUnderstandResponse;
}

export async function createRunnerSiteIntake(input: { text: string; sourceName?: string; title?: string }) {
  const response = await runnerFetch("/intakes/site", {
    method: "POST",
    body: JSON.stringify({
      text: input.text,
      title: input.title ?? "FlowFit UI 수동 수집",
      sourceName: input.sourceName ?? "flowfit_workspace",
      url: "flowfit://workspace/manual-intake",
      syncUnderstanding: true,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner 수집 실패: ${response.status}`);
  }

  return await response.json();
}

export async function understandRunnerMessage(input: { text: string; sourceName?: string }) {
  const response = await runnerFetch("/understand", {
    method: "POST",
    body: JSON.stringify({
      rawText: input.text,
      sourceType: "manual",
      sourceName: input.sourceName ?? "flowfit_chat",
      companyId: "company_demo",
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner 이해 실패: ${response.status}`);
  }

  return (await response.json()) as RunnerUnderstandResponse;
}

export async function runChatWorkPipeline(input: { text: string; sourceName?: string; externalId?: string }) {
  const response = await runnerFetch("/chat/work", {
    method: "POST",
    body: JSON.stringify({
      text: input.text,
      sourceName: input.sourceName ?? "operation_chat",
      ...(input.externalId ? { externalId: input.externalId } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner 채팅 파이프라인 실패: ${response.status}`);
  }

  return (await response.json()) as RunnerChatWorkResponse;
}

export async function chatRunnerMessage(input: { message: string; system?: string; history?: RunnerChatHistoryMessage[] }) {
  const response = await runnerFetch("/chat", {
    method: "POST",
    body: JSON.stringify({ message: input.message, system: input.system, history: input.history ?? [] }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner 채팅 실패: ${response.status}`);
  }

  return (await response.json()) as RunnerChatResponse;
}

export async function getRunnerStatus(runId: string) {
  const response = await runnerFetch(`/run/${encodeURIComponent(runId)}/status`);
  if (!response.ok) {
    throw new Error(`Runner 상태 조회 실패: ${response.status}`);
  }
  return (await response.json()) as RunnerStatusResponse;
}

export async function getRunnerApprovals(input: { status?: string; companyId?: string; limit?: number } = {}) {
  const search = new URLSearchParams();
  if (input.status) search.set("status", input.status);
  if (input.companyId) search.set("companyId", input.companyId);
  if (input.limit) search.set("limit", String(input.limit));

  const response = await runnerFetch(`/approvals${search.size ? `?${search.toString()}` : ""}`);
  if (!response.ok) {
    throw new Error(`Runner 승인 목록 조회 실패: ${response.status}`);
  }
  return (await response.json()) as RunnerApprovalListResponse;
}

export async function decideRunnerApproval(input: {
  approvalId: string;
  decision: "approve" | "reject";
  note?: string;
  resolvedBy?: string;
}) {
  const response = await runnerFetch(`/approvals/${encodeURIComponent(input.approvalId)}/${input.decision}`, {
    method: "POST",
    body: JSON.stringify({
      note: input.note,
      resolvedBy: input.resolvedBy ?? "owner",
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner 승인 처리 실패: ${response.status}`);
  }
  return await response.json();
}

export async function upsertRunnerAutonomyCriterion(input: RunnerAutonomyCriterionInput) {
  const response = await runnerFetch("/autonomy/criteria", {
    method: "POST",
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Runner autonomy criterion update failed: ${response.status}`);
  }

  return await response.json();
}

export function getRunnerStreamPath(runId: string) {
  return `/run/${encodeURIComponent(runId)}/stream`;
}

// ── 원격 실행 에이전트(기기) 관리 ───────────────────────
// 관리자 화면에서 쓰는 device 큐 API. 에이전트 자체는 Runner에 직접 교신한다.

export type RunnerDevice = {
  id: string;
  companyId: string;
  label?: string;
  platform?: string;
  agentVersion?: string;
  capabilityScope: string[];
  autonomyStage: "SHADOW" | "ASSIST" | "AUTO";
  status: "active" | "revoked";
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
};

export async function createDevicePairingCode(input: { companyId?: string; label?: string; expiresInHours?: number } = {}) {
  const response = await runnerFetch("/devices/pairing-codes", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `페어링 코드 발급 실패: ${response.status}`);
  }
  return (await response.json()) as { code: string; expiresAt: string | null };
}

export async function listDevices(companyId?: string) {
  const search = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
  const response = await runnerFetch(`/devices${search}`);
  if (!response.ok) {
    throw new Error(`기기 목록 조회 실패: ${response.status}`);
  }
  return (await response.json()) as { count: number; devices: RunnerDevice[] };
}

export async function revokeDevice(deviceId: string) {
  const response = await runnerFetch(`/devices/${encodeURIComponent(deviceId)}/revoke`, { method: "POST" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `기기 회수 실패: ${response.status}`);
  }
  return (await response.json()) as { ok: boolean };
}

export async function setDeviceStage(deviceId: string, stage: "SHADOW" | "ASSIST" | "AUTO") {
  const response = await runnerFetch(`/devices/${encodeURIComponent(deviceId)}/stage`, {
    method: "POST",
    body: JSON.stringify({ stage }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `기기 단계 변경 실패: ${response.status}`);
  }
  return (await response.json()) as { ok: boolean };
}

export async function dispatchTaskToDevice(input: {
  companyId?: string;
  capability: string;
  fields: Record<string, unknown>;
  taskId?: string;
  approvalId?: string;
  deviceId?: string;
}) {
  const response = await runnerFetch("/devices/dispatch", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    commandId?: string;
    deviceId?: string;
    stepCount?: number;
    error?: string;
    missingFields?: string[];
  };
  if (!response.ok || !body.ok) {
    const err = new Error(typeof body.error === "string" ? body.error : `dispatch 실패: ${response.status}`);
    (err as { missingFields?: string[] }).missingFields = body.missingFields;
    throw err;
  }
  return body as { ok: true; commandId: string; deviceId: string; stepCount: number };
}

export async function enqueueDeviceCommand(input: {
  deviceId: string;
  companyId?: string;
  capability: string;
  steps: Array<{ op: string; target?: string; value?: string; verify?: string }>;
  taskId?: string;
  approvalId?: string;
  idempotencyKey?: string;
}) {
  const { deviceId, ...body } = input;
  const response = await runnerFetch(`/devices/${encodeURIComponent(deviceId)}/commands`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(typeof errBody?.error === "string" ? errBody.error : `명령 등록 실패: ${response.status}`);
  }
  return (await response.json()) as { commandId: string };
}

export async function provisionRunnerSession(input: { token: string; deviceLabel?: string }) {
  const response = await runnerFetch("/session/provision", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `Runner session provision failed: ${response.status}`);
  }
  return body as RunnerProvisionResponse;
}
