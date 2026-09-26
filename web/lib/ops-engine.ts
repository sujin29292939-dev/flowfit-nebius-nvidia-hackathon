import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { customers } from "@/lib/mock-db";
import type {
  AgentRunDetailRecord,
  AgentRunFeedbackRecord,
  AgentRunFeedbackType,
  AgentRunLifecycleStatus,
  ApprovalDecisionStatus,
  AgentRunRecord,
  ApprovalQueueItem,
  ContextGraphEdgeRecord,
  ContextGraphNodeRecord,
  ContextGraphSummaryRecord,
  DataMode,
  KnowledgeChangeRequestRecord,
  KnowledgeChangeStatus,
} from "@/lib/types";

type QuoteDecisionInput = {
  quoteId: string;
  actorId?: string | null;
  actorRole?: string | null;
  notes?: string | null;
  reasonCode?: string | null;
  correlationId?: string | null;
};

type AgentFeedbackInput = {
  feedbackType: AgentRunFeedbackType | string;
  feedbackText: string;
  editedBefore?: string | null;
  editedAfter?: string | null;
  reviewer: string;
};

type KnowledgeChangeReviewInput = {
  status: KnowledgeChangeStatus | string;
  reviewer: string;
};

const OPS_ENGINE_SCHEMA_VERSION = "flowfit.ops-engine.v1";

type OpsTransitionEntity =
  | "approval_decision"
  | "agent_run_status"
  | "knowledge_change_status";

type OpsStateValue =
  | ApprovalDecisionStatus
  | AgentRunLifecycleStatus
  | KnowledgeChangeStatus
  | string;

type OpsTransitionLog = {
  id: string;
  schema_version: string;
  received_at: string;
  processed_at: string;
  entity_type: OpsTransitionEntity;
  entity_id: string;
  event: string;
  from_state: string | null;
  to_state: string;
  accepted: boolean;
  actor: string;
  reason: string | null;
  metadata?: Record<string, unknown>;
};

type OpsState = {
  schema_version: string;
  received_at: string;
  processed_at: string;
  transition_log: OpsTransitionLog[];
  approvalQueue: ApprovalQueueItem[];
  agentRuns: AgentRunRecord[];
  feedbackLogs: AgentRunFeedbackRecord[];
  contextNodes: ContextGraphNodeRecord[];
  contextEdges: ContextGraphEdgeRecord[];
  knowledgeChangeRequests: KnowledgeChangeRequestRecord[];
};

const STORE_DIR = path.join(process.cwd(), ".flowfit");
const STORE_FILE = path.join(STORE_DIR, "ops-engine-store.json");

const allowedTransitions: Record<OpsTransitionEntity, Record<string, string[]>> = {
  approval_decision: {
    "approval-pending": ["approved", "rejected"],
    approved: ["rejected"],
    rejected: ["approved"],
  },
  agent_run_status: {
    draft: ["running", "completed", "needs-feedback", "approved", "rejected"],
    running: ["completed", "needs-feedback", "approved", "rejected"],
    completed: ["approved", "rejected", "needs-feedback", "feedback-logged"],
    "needs-feedback": ["feedback-logged", "approved", "rejected"],
    "feedback-logged": ["approved", "rejected", "needs-feedback"],
    approved: ["feedback-logged", "needs-feedback", "rejected"],
    rejected: ["feedback-logged", "needs-feedback", "approved"],
  },
  knowledge_change_status: {
    draft: ["pending", "approved", "rejected"],
    pending: ["approved", "rejected"],
    approved: ["rejected", "pending"],
    rejected: ["approved", "pending"],
  },
};

function nowIso() {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canTransition(entity: OpsTransitionEntity, from: OpsStateValue | null, to: OpsStateValue) {
  if (!from || from === to) return true;
  return allowedTransitions[entity]?.[from]?.includes(to) ?? false;
}

function logTransition(
  state: OpsState,
  input: {
    entity: OpsTransitionEntity;
    entityId: string;
    event: string;
    from: OpsStateValue | null;
    to: OpsStateValue;
    actor: string;
    reason?: string | null;
    receivedAt?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const processedAt = nowIso();
  const accepted = canTransition(input.entity, input.from, input.to);

  state.transition_log.unshift({
    id: randomUUID(),
    schema_version: OPS_ENGINE_SCHEMA_VERSION,
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
    metadata: { schema_version: OPS_ENGINE_SCHEMA_VERSION, ...input.metadata },
  });

  if (!accepted) {
    throw new Error(
      `허용되지 않은 운영 상태 전이입니다. ${input.entity} ${input.from ?? "-"} -> ${input.to}`,
    );
  }
}

function withOpsContract(state: Partial<OpsState> | null | undefined): OpsState {
  const createdAt = nowIso();
  const source = state ?? {};
  return {
    schema_version: OPS_ENGINE_SCHEMA_VERSION,
    received_at: typeof source.received_at === "string" ? source.received_at : createdAt,
    processed_at: typeof source.processed_at === "string" ? source.processed_at : createdAt,
    transition_log: Array.isArray(source.transition_log) ? source.transition_log : [],
    approvalQueue: Array.isArray(source.approvalQueue) ? source.approvalQueue : [],
    agentRuns: Array.isArray(source.agentRuns) ? source.agentRuns : [],
    feedbackLogs: Array.isArray(source.feedbackLogs) ? source.feedbackLogs : [],
    contextNodes: Array.isArray(source.contextNodes) ? source.contextNodes : [],
    contextEdges: Array.isArray(source.contextEdges) ? source.contextEdges : [],
    knowledgeChangeRequests: Array.isArray(source.knowledgeChangeRequests)
      ? source.knowledgeChangeRequests
      : [],
  };
}

function normalizeKey(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function toRoleDisplayName(value?: string | null) {
  if (!value) return "승인 담당자";

  switch (value) {
    case "Approver":
      return "승인 담당자";
    case "Sales":
      return "영업 담당자";
    case "Ops reviewer":
      return "운영 검토자";
    case "Admin reviewer":
      return "관리자 검토자";
    default:
      return value;
  }
}

function findNodeByKey(state: OpsState, nodeKey: string) {
  return state.contextNodes.find((node) => node.nodeKey === nodeKey) ?? null;
}

function upsertNode(
  state: OpsState,
  nodeType: ContextGraphNodeRecord["nodeType"],
  nodeKey: string,
  nodeValue: string,
  metadata: Record<string, unknown> = {},
) {
  const existing = state.contextNodes.find((node) => node.nodeKey === nodeKey);

  if (existing) {
    existing.nodeType = nodeType;
    existing.nodeValue = nodeValue;
    existing.metadata = { ...existing.metadata, ...metadata };
    return existing;
  }

  const node: ContextGraphNodeRecord = {
    id: randomUUID(),
    nodeType,
    nodeKey,
    nodeValue,
    metadata,
    createdAt: nowIso(),
  };

  state.contextNodes.unshift(node);
  return node;
}

function createEdge(
  state: OpsState,
  fromNodeId: string,
  toNodeId: string,
  relationType: string,
  sourceRunId: string | null,
  confidence = 1,
) {
  const edge: ContextGraphEdgeRecord = {
    id: randomUUID(),
    fromNodeId,
    toNodeId,
    relationType,
    confidence,
    sourceRunId,
    createdAt: nowIso(),
  };

  state.contextEdges.unshift(edge);
  return edge;
}

function createSeedState(): OpsState {
  const createdAt = nowIso();
  const firstCustomer = customers[0];
  const secondCustomer = customers[3] ?? customers[1] ?? customers[0];

  const state: OpsState = {
    schema_version: OPS_ENGINE_SCHEMA_VERSION,
    received_at: createdAt,
    processed_at: createdAt,
    transition_log: [
      {
        id: randomUUID(),
        schema_version: OPS_ENGINE_SCHEMA_VERSION,
        received_at: createdAt,
        processed_at: createdAt,
        entity_type: "approval_decision",
        entity_id: "ops-engine-store",
        event: "seed_store_initialized",
        from_state: null,
        to_state: "approval-pending",
        accepted: true,
        actor: "system",
        reason: "문의 접수 자동화 계약 저장소를 초기화했습니다.",
      },
    ],
    approvalQueue: [
      {
        quoteId: "quote-ora-approval-001",
        inquiryId: "inq-ora-021",
        correlationId: "corr-ora-quote-001",
        customerId: firstCustomer.id,
        customerName: firstCustomer.name,
        totalAmount: 1280000,
        dueDate: "2026-04-18",
        currentState: "approval_pending",
        currentRevisionNo: 2,
        items: ["예약 확인 메시지", "상담 접수 메시지", "운영 검토 메모"],
        lastActorRole: "Sales",
        lastEventAt: "2026-04-16T09:12:00+09:00",
        createdAt,
        updatedAt: createdAt,
        hoursInState: 3.2,
        decisionStatus: "approval-pending",
      },
      {
        quoteId: "quote-jayu-approval-002",
        inquiryId: "inq-jayu-018",
        correlationId: "corr-jayu-quote-002",
        customerId: secondCustomer.id,
        customerName: secondCustomer.name,
        totalAmount: 760000,
        dueDate: "2026-04-19",
        currentState: "approval_pending",
        currentRevisionNo: 1,
        items: ["불만 접수 1차 회신", "운영자 확인 필요"],
        lastActorRole: "Sales",
        lastReasonCode: "manual_review_required",
        lastEventAt: "2026-04-16T08:40:00+09:00",
        createdAt,
        updatedAt: createdAt,
        hoursInState: 4.5,
        decisionStatus: "approval-pending",
      },
    ],
    agentRuns: [],
    feedbackLogs: [],
    contextNodes: [],
    contextEdges: [],
    knowledgeChangeRequests: [],
  };

  const seedRun: AgentRunRecord = {
    id: randomUUID(),
    sourceType: "quote",
    sourceId: "quote-seed-approval",
    actorId: "approver-demo",
    actorLabel: "승인 담당자",
    department: "approval",
    role: "Approver",
    situationTag: "quote_revision_request",
    promptInput: "견적 quote-seed-approval 건을 검토하고 수정 요청 메시지를 정리해 주세요.",
    referencedSources: [{ kind: "seed", path: "/admin/approval-queue" }],
    toolCalls: [{ tool: "local.approval.review", eventName: "quote_approval_rejected" }],
    intermediateReasoningSummary:
      "가격 조건과 예외 규칙을 비교한 결과, 바로 승인하기보다 수정 요청을 남기는 편이 적절하다고 판단했습니다.",
    outputDraft: "수정 요청 초안이 생성되었습니다.",
    finalOutput: "견적 수정 요청 안내가 생성되었습니다.",
    status: "feedback-logged",
    createdAt,
    updatedAt: createdAt,
  };
  state.agentRuns.unshift(seedRun);
  logTransition(state, {
    entity: "agent_run_status",
    entityId: seedRun.id,
    event: "seed_agent_run_created",
    from: null,
    to: seedRun.status,
    actor: "system",
    receivedAt: createdAt,
    metadata: { sourceType: seedRun.sourceType, sourceId: seedRun.sourceId },
  });

  const feedback: AgentRunFeedbackRecord = {
    id: randomUUID(),
    agentRunId: seedRun.id,
    feedbackType: "request_change",
    feedbackText: "반복되는 배송 예외가 있어 승인 전 확인 규칙을 보강해야 합니다.",
    editedBefore: seedRun.outputDraft,
    editedAfter: "승인 전 예외 규칙 확인 문장을 추가한 수정 초안입니다.",
    reviewer: "운영 검토자",
    createdAt,
  };
  state.feedbackLogs.unshift(feedback);

  const request: KnowledgeChangeRequestRecord = {
    id: randomUUID(),
    title: "반복 예외 대응 규칙 보강",
    summary: feedback.feedbackText,
    changeType: "update_rule",
    diffBefore: { finalOutput: seedRun.finalOutput },
    diffAfter: { editedAfter: feedback.editedAfter, reviewer: feedback.reviewer },
    reason: `실행 ${seedRun.id} 피드백을 바탕으로 규칙 보강이 필요합니다.`,
    sourceRunId: seedRun.id,
    status: "pending",
    reviewer: null,
    createdAt,
    updatedAt: createdAt,
  };
  state.knowledgeChangeRequests.unshift(request);
  logTransition(state, {
    entity: "knowledge_change_status",
    entityId: request.id,
    event: "seed_knowledge_change_created",
    from: null,
    to: request.status,
    actor: "system",
    receivedAt: createdAt,
    metadata: { sourceRunId: seedRun.id, changeType: request.changeType },
  });

  const sourceNode = upsertNode(
    state,
    "source",
    `source:${normalizeKey(`quote:${seedRun.sourceId}`)}`,
    `quote:${seedRun.sourceId}`,
    { runId: seedRun.id },
  );
  const departmentNode = upsertNode(
    state,
    "department",
    "department:approval",
    "승인",
    { runId: seedRun.id },
  );
  const roleNode = upsertNode(state, "role", "role:approver", "승인 담당자", {
    runId: seedRun.id,
  });
  const situationNode = upsertNode(
    state,
    "situation",
    "situation:quote-revision-request",
    "견적 수정 요청",
    { runId: seedRun.id },
  );
  const outputNode = upsertNode(state, "output", `output:${seedRun.id}`, seedRun.finalOutput ?? "", {
    runId: seedRun.id,
  });
  const ruleNode = upsertNode(state, "rule", `rule-request:${request.id}`, request.title, {
    requestId: request.id,
  });

  createEdge(state, departmentNode.id, roleNode.id, "owns_role", seedRun.id, 0.9);
  createEdge(state, roleNode.id, situationNode.id, "handles", seedRun.id, 0.85);
  createEdge(state, outputNode.id, sourceNode.id, "generated_for", seedRun.id, 1);
  createEdge(state, ruleNode.id, outputNode.id, "updates_output", seedRun.id, 0.85);

  return state;
}

async function ensureStoreDir() {
  await fs.mkdir(STORE_DIR, { recursive: true });
}

async function writeState(state: OpsState) {
  state.schema_version = OPS_ENGINE_SCHEMA_VERSION;
  state.processed_at = nowIso();
  await ensureStoreDir();
  await fs.writeFile(STORE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function readState(): Promise<OpsState> {
  await ensureStoreDir();

  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<OpsState> | null;
    const migrated = withOpsContract(parsed);

    if (
      !migrated ||
      !Array.isArray(migrated.approvalQueue) ||
      !Array.isArray(migrated.agentRuns) ||
      !Array.isArray(migrated.feedbackLogs) ||
      !Array.isArray(migrated.contextNodes) ||
      !Array.isArray(migrated.contextEdges) ||
      !Array.isArray(migrated.knowledgeChangeRequests)
    ) {
      throw new Error("invalid store");
    }

    if (parsed?.schema_version !== OPS_ENGINE_SCHEMA_VERSION || !Array.isArray(parsed?.transition_log)) {
      logTransition(migrated, {
        entity: "approval_decision",
        entityId: "ops-engine-store",
        event: "legacy_store_migrated",
        from: null,
        to: "approval-pending",
        actor: "system",
        metadata: {
          approvalQueueCount: migrated.approvalQueue.length,
          agentRunCount: migrated.agentRuns.length,
          knowledgeChangeRequestCount: migrated.knowledgeChangeRequests.length,
        },
      });
      await writeState(migrated);
    }

    return migrated;
  } catch {
    const seeded = createSeedState();
    await writeState(seeded);
    return seeded;
  }
}

function wrap<T>(data: T) {
  return {
    mode: "live" as const,
    data,
  };
}

function sortByUpdatedAt<T extends { updatedAt?: string; createdAt?: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const left = a.updatedAt ?? a.createdAt ?? "";
    const right = b.updatedAt ?? b.createdAt ?? "";
    return +new Date(right) - +new Date(left);
  });
}

function buildRunFromDecision(
  state: OpsState,
  queueItem: ApprovalQueueItem,
  input: QuoteDecisionInput,
  decision: "approved" | "rejected",
) {
  const createdAt = nowIso();
  const run: AgentRunRecord = {
    id: randomUUID(),
    sourceType: "quote",
    sourceId: queueItem.quoteId,
    actorId: input.actorId ?? "admin-ui",
    actorLabel: toRoleDisplayName(input.actorRole),
    department: "approval",
    role: input.actorRole ?? "Approver",
    situationTag: decision === "approved" ? "quote_approval" : "quote_revision_request",
    promptInput:
      decision === "approved"
        ? `견적 ${queueItem.quoteId} 건을 승인하고 최종 안내 문구를 정리해 주세요.`
        : `견적 ${queueItem.quoteId} 건을 반려하고 수정 요청 내용을 정리해 주세요.`,
    referencedSources: [
      {
        kind: "approval-queue",
        quoteId: queueItem.quoteId,
        customerName: queueItem.customerName,
      },
    ],
    toolCalls: [
      {
        tool: "local.approval.review",
        eventName: decision === "approved" ? "quote_approved" : "quote_approval_rejected",
      },
    ],
    intermediateReasoningSummary:
      decision === "approved"
        ? `${queueItem.customerName} 건은 현재 조건으로 승인 가능하다고 판단했습니다.`
        : `${queueItem.customerName} 건은 ${input.reasonCode ?? "수정 요청"} 사유로 재검토가 필요합니다.`,
    outputDraft:
      decision === "approved"
        ? `${queueItem.customerName} 건 승인 초안이 준비되었습니다.`
        : `${queueItem.customerName} 건 수정 요청 초안이 준비되었습니다.`,
    finalOutput:
      decision === "approved"
        ? `${queueItem.customerName} 건을 승인 처리하고 후속 메시지 준비를 시작합니다.`
        : `${queueItem.customerName} 건을 반려 처리하고 수정 요청 메모를 남깁니다. ${input.notes ?? ""}`.trim(),
    status: decision === "approved" ? "approved" : "feedback-logged",
    createdAt,
    updatedAt: createdAt,
  };
  state.agentRuns.unshift(run);
  logTransition(state, {
    entity: "agent_run_status",
    entityId: run.id,
    event: decision === "approved" ? "agent_run_created_for_approval" : "agent_run_created_for_rejection",
    from: null,
    to: run.status,
    actor: input.actorId ?? "admin-ui",
    reason: input.reasonCode ?? null,
    metadata: {
      sourceType: run.sourceType,
      sourceId: run.sourceId,
      decision,
      correlationId: input.correlationId ?? queueItem.correlationId ?? null,
    },
  });

  const sourceNode = upsertNode(
    state,
    "source",
    `source:${normalizeKey(`quote:${run.sourceId}`)}`,
    `quote:${run.sourceId}`,
    { runId: run.id, customerName: queueItem.customerName },
  );
  const roleNode = upsertNode(
    state,
    "role",
    `role:${normalizeKey(run.role ?? "approver")}`,
    toRoleDisplayName(run.role),
    { runId: run.id },
  );
  const situationNode = upsertNode(
    state,
    "situation",
    `situation:${normalizeKey(run.situationTag ?? "general")}`,
    run.situationTag === "quote_approval" ? "견적 승인" : "견적 수정 요청",
    { runId: run.id },
  );
  const outputNode = upsertNode(state, "output", `output:${run.id}`, run.finalOutput ?? "", {
    runId: run.id,
  });

  createEdge(state, roleNode.id, situationNode.id, "handles", run.id, 0.85);
  createEdge(state, outputNode.id, sourceNode.id, "generated_for", run.id, 1);

  let feedback: AgentRunFeedbackRecord | null = null;
  let request: KnowledgeChangeRequestRecord | null = null;

  if (decision === "rejected") {
    feedback = {
      id: randomUUID(),
      agentRunId: run.id,
      feedbackType: "request_change",
      feedbackText:
        input.notes?.trim() ||
        `${queueItem.quoteId} 건은 ${input.reasonCode ?? "수정 요청"} 사유로 재검토가 필요합니다.`,
      editedBefore: run.outputDraft,
      editedAfter: input.notes?.trim() || "수정 요청 기준과 예외 확인 문장을 보강한 초안입니다.",
      reviewer: run.actorLabel ?? "승인 담당자",
      createdAt,
    };
    state.feedbackLogs.unshift(feedback);

    const reviewerNode = upsertNode(
      state,
      "person",
      `person:${normalizeKey(feedback.reviewer)}`,
      feedback.reviewer,
      { runId: run.id },
    );
    const ruleNode = upsertNode(
      state,
      input.reasonCode?.includes("exception") ? "exception" : "rule",
      `rule-request:${normalizeKey(`${run.sourceId}:${feedback.feedbackType}`)}`,
      feedback.feedbackText,
      { runId: run.id, reasonCode: input.reasonCode ?? null },
    );
    createEdge(state, reviewerNode.id, ruleNode.id, "requested_change", run.id, 0.9);
    createEdge(state, ruleNode.id, outputNode.id, "updates_output", run.id, 0.85);

    request = {
      id: randomUUID(),
      title: `견적 ${run.sourceId} 검토 규칙 업데이트`,
      summary: feedback.feedbackText,
      changeType: input.reasonCode?.includes("exception") ? "new_exception" : "update_rule",
      diffBefore: { finalOutput: run.finalOutput },
      diffAfter: { editedAfter: feedback.editedAfter, reviewer: feedback.reviewer },
      reason: `실행 ${run.id} 피드백을 반영해 지식 업데이트가 필요합니다.`,
      sourceRunId: run.id,
      status: "pending",
      reviewer: null,
      createdAt,
      updatedAt: createdAt,
    };
    state.knowledgeChangeRequests.unshift(request);
    logTransition(state, {
      entity: "knowledge_change_status",
      entityId: request.id,
      event: "knowledge_change_created_from_rejection",
      from: null,
      to: request.status,
      actor: run.actorId ?? "admin-ui",
      reason: input.reasonCode ?? feedback.feedbackText,
      metadata: { sourceRunId: run.id, changeType: request.changeType },
    });
  }

  return { run, feedback, request };
}

export async function getOpsConnectionMode(): Promise<DataMode> {
  return "live";
}

export async function getApprovalQueue() {
  const state = await readState();
  return wrap(sortByUpdatedAt(state.approvalQueue).map((item) => clone(item)));
}

export async function approveQuote(input: QuoteDecisionInput) {
  const state = await readState();
  const queueItem = state.approvalQueue.find((item) => item.quoteId === input.quoteId);

  if (!queueItem) {
    throw new Error("승인 대기 항목을 찾을 수 없습니다.");
  }

  const receivedAt = nowIso();
  logTransition(state, {
    entity: "approval_decision",
    entityId: queueItem.quoteId,
    event: "quote_approval_approved",
    from: queueItem.decisionStatus,
    to: "approved",
    actor: input.actorId ?? "admin-ui",
    reason: input.notes ?? null,
    receivedAt,
    metadata: {
      inquiryId: queueItem.inquiryId ?? null,
      correlationId: input.correlationId ?? queueItem.correlationId ?? null,
    },
  });
  queueItem.decisionStatus = "approved";
  queueItem.updatedAt = receivedAt;
  state.approvalQueue = state.approvalQueue.filter((item) => item.quoteId !== input.quoteId);
  const created = buildRunFromDecision(state, queueItem, input, "approved");
  await writeState(state);

  return wrap({
    success: true,
    eventId: randomUUID(),
    agentRunId: created.run.id,
  });
}

export async function rejectQuote(input: QuoteDecisionInput) {
  const state = await readState();
  const queueItem = state.approvalQueue.find((item) => item.quoteId === input.quoteId);

  if (!queueItem) {
    throw new Error("반려할 승인 대기 항목을 찾을 수 없습니다.");
  }

  const receivedAt = nowIso();
  logTransition(state, {
    entity: "approval_decision",
    entityId: queueItem.quoteId,
    event: "quote_approval_rejected",
    from: queueItem.decisionStatus,
    to: "rejected",
    actor: input.actorId ?? "admin-ui",
    reason: input.notes ?? input.reasonCode ?? null,
    receivedAt,
    metadata: {
      inquiryId: queueItem.inquiryId ?? null,
      correlationId: input.correlationId ?? queueItem.correlationId ?? null,
      reasonCode: input.reasonCode ?? null,
    },
  });
  queueItem.decisionStatus = "rejected";
  queueItem.updatedAt = receivedAt;
  state.approvalQueue = state.approvalQueue.filter((item) => item.quoteId !== input.quoteId);
  const created = buildRunFromDecision(state, queueItem, input, "rejected");
  await writeState(state);

  return wrap({
    success: true,
    eventId: randomUUID(),
    agentRunId: created.run.id,
    knowledgeChangeRequestId: created.request?.id ?? null,
  });
}

export async function getAgentRuns() {
  const state = await readState();
  return wrap(sortByUpdatedAt(state.agentRuns).map((item) => clone(item)));
}

export async function getAgentRunDetail(runId: string) {
  const state = await readState();
  const run = state.agentRuns.find((item) => item.id === runId);

  if (!run) {
    return wrap<AgentRunDetailRecord | null>(null);
  }

  return wrap({
    ...clone(run),
    feedbackLogs: sortByUpdatedAt(
      state.feedbackLogs.filter((item) => item.agentRunId === runId),
    ).map((item) => clone(item)),
    knowledgeChangeRequests: sortByUpdatedAt(
      state.knowledgeChangeRequests.filter((item) => item.sourceRunId === runId),
    ).map((item) => clone(item)),
  } satisfies AgentRunDetailRecord);
}

export async function addAgentRunFeedback(runId: string, input: AgentFeedbackInput) {
  const state = await readState();
  const run = state.agentRuns.find((item) => item.id === runId);

  if (!run) {
    throw new Error("피드백을 남길 실행 이력을 찾을 수 없습니다.");
  }

  const createdAt = nowIso();
  const feedback: AgentRunFeedbackRecord = {
    id: randomUUID(),
    agentRunId: runId,
    feedbackType: input.feedbackType,
    feedbackText: input.feedbackText,
    editedBefore: input.editedBefore ?? null,
    editedAfter: input.editedAfter ?? null,
    reviewer: input.reviewer,
    createdAt,
  };
  state.feedbackLogs.unshift(feedback);

  const previousStatus = run.status;
  const nextStatus = input.feedbackType === "approve" ? "approved" : "feedback-logged";
  run.updatedAt = createdAt;
  run.status = nextStatus;
  logTransition(state, {
    entity: "agent_run_status",
    entityId: run.id,
    event: "agent_run_feedback_recorded",
    from: previousStatus,
    to: nextStatus,
    actor: input.reviewer,
    reason: input.feedbackText,
    receivedAt: createdAt,
    metadata: {
      feedbackId: feedback.id,
      feedbackType: input.feedbackType,
      edited: Boolean(input.editedAfter?.trim()),
    },
  });
  if (input.editedAfter?.trim()) {
    run.finalOutput = input.editedAfter.trim();
  }

  const reviewerNode = upsertNode(
    state,
    "person",
    `person:${normalizeKey(input.reviewer)}`,
    input.reviewer,
    { runId },
  );
  const outputNode = upsertNode(
    state,
    "output",
    `output:${runId}`,
    input.editedAfter?.trim() || run.finalOutput || run.outputDraft || "",
    { runId },
  );

  let request: KnowledgeChangeRequestRecord | null = null;

  if (input.feedbackType === "approve") {
    createEdge(state, reviewerNode.id, outputNode.id, "approved_output", runId, 1);
  } else {
    const ruleNode = upsertNode(
      state,
      input.feedbackType === "reject" ? "exception" : "rule",
      `${input.feedbackType}:${normalizeKey(`${runId}:${input.feedbackText}`)}`,
      input.feedbackText,
      { runId, reviewer: input.reviewer },
    );
    createEdge(state, reviewerNode.id, ruleNode.id, "provided_feedback", runId, 0.9);
    createEdge(state, ruleNode.id, outputNode.id, "updates_output", runId, 0.85);

    request = {
      id: randomUUID(),
      title: `실행 ${runId} 피드백 반영 검토`,
      summary: input.feedbackText,
      changeType: input.feedbackType === "reject" ? "update_priority" : "update_rule",
      diffBefore: { editedBefore: input.editedBefore ?? null },
      diffAfter: { editedAfter: input.editedAfter ?? null, reviewer: input.reviewer },
      reason: `${runId} 처리 피드백을 운영 규칙 수정 요청으로 정리했습니다.`,
      sourceRunId: runId,
      status: "pending",
      reviewer: null,
      createdAt,
      updatedAt: createdAt,
    };
    state.knowledgeChangeRequests.unshift(request);
    logTransition(state, {
      entity: "knowledge_change_status",
      entityId: request.id,
      event: "knowledge_change_created_from_feedback",
      from: null,
      to: request.status,
      actor: input.reviewer,
      reason: input.feedbackText,
      receivedAt: createdAt,
      metadata: { sourceRunId: runId, changeType: request.changeType, feedbackId: feedback.id },
    });

    const requestNode = upsertNode(
      state,
      "rule",
      `knowledge-change:${request.id}`,
      request.title,
      { runId, requestId: request.id },
    );
    createEdge(state, requestNode.id, outputNode.id, "reviews_output", runId, 0.8);
  }

  await writeState(state);

  return wrap({
    feedback: clone(feedback),
    knowledgeChangeRequest: request ? clone(request) : null,
  });
}

export async function getContextGraphSummary() {
  const state = await readState();

  return wrap<ContextGraphSummaryRecord>({
    mode: "live",
    nodeCount: state.contextNodes.length,
    edgeCount: state.contextEdges.length,
    recentRules: state.contextNodes
      .filter((node) => node.nodeType === "rule")
      .slice(0, 5)
      .map((item) => clone(item)),
    recentExceptions: state.contextNodes
      .filter((node) => node.nodeType === "exception")
      .slice(0, 5)
      .map((item) => clone(item)),
    recentChangeRequests: sortByUpdatedAt(state.knowledgeChangeRequests)
      .slice(0, 5)
      .map((item) => clone(item)),
    nodes: state.contextNodes.map((item) => clone(item)),
    edges: state.contextEdges.map((item) => clone(item)),
  });
}

export async function getKnowledgeChangeRequests() {
  const state = await readState();
  return wrap(sortByUpdatedAt(state.knowledgeChangeRequests).map((item) => clone(item)));
}

export async function reviewKnowledgeChangeRequest(
  id: string,
  input: KnowledgeChangeReviewInput,
) {
  const state = await readState();
  const current = state.knowledgeChangeRequests.find((item) => item.id === id);

  if (!current) {
    throw new Error("검토할 운영 규칙 수정 요청을 찾을 수 없습니다.");
  }

  const previousStatus = current.status;
  const reviewedAt = nowIso();
  logTransition(state, {
    entity: "knowledge_change_status",
    entityId: current.id,
    event: "knowledge_change_reviewed",
    from: previousStatus,
    to: input.status,
    actor: input.reviewer,
    reason: input.status === "approved" ? "변경 요청 승인" : "변경 요청 반려",
    receivedAt: reviewedAt,
    metadata: {
      sourceRunId: current.sourceRunId ?? null,
      changeType: current.changeType,
    },
  });
  current.status = input.status;
  current.reviewer = input.reviewer;
  current.updatedAt = reviewedAt;

  const reviewerNode = upsertNode(
    state,
    "person",
    `person:${normalizeKey(input.reviewer)}`,
    input.reviewer,
    { requestId: id },
  );
  const requestNode = upsertNode(state, "rule", `knowledge-change:${id}`, current.title, {
    requestId: id,
    status: input.status,
  });
  createEdge(
    state,
    reviewerNode.id,
    requestNode.id,
    input.status === "approved" ? "approved_change" : "rejected_change",
    current.sourceRunId ?? null,
    0.95,
  );

  await writeState(state);

  return wrap(clone(current));
}

export async function getOpsEngineContract() {
  const state = await readState();
  return clone({
    schema_version: state.schema_version,
    received_at: state.received_at,
    processed_at: state.processed_at,
    transition_log: state.transition_log.slice(0, 50),
    entities: ["approval_decision", "agent_run_status", "knowledge_change_status"],
  });
}
