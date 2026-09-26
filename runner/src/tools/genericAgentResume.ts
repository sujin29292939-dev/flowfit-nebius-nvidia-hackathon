import { createHash } from "node:crypto";
import type { Tier } from "../connectors/offlinePolicy.js";

export const DEFAULT_GENERIC_AGENT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export type ContextDependency = "none" | "run-context" | "unknown";

export type ResumeResult =
  | "executed-standalone"
  | "routed-to-rejudge"
  | "rejected-hard-block"
  | "rejected-expired"
  | "rejected-hash-mismatch"
  | "already-resumed";

export interface GuardCard {
  id: string;
  taskId: string;
  runId: string;
  actionName: string;
  payloadHash: string;
  contextDependency: ContextDependency;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "approved" | "resumed" | "expired";
  source: "generic_agent_action_guard";
}

export interface GenericAgentResumeMetadata {
  actionName: string;
  contextDependency: ContextDependency;
  payloadCaptured: boolean;
  payloadHash?: string;
  payloadHashAlgorithm: "sha256:stable-json";
  resumePolicy: "standalone_or_rejudge";
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function buildGenericAgentResumeMetadata(input: {
  actionName: string;
  payload?: unknown;
  hasPayload: boolean;
  contextDependency?: unknown;
}): GenericAgentResumeMetadata {
  const contextDependency = input.hasPayload
    ? normalizeContextDependency(input.contextDependency, "none")
    : "unknown";
  return {
    actionName: input.actionName,
    contextDependency,
    payloadCaptured: input.hasPayload,
    payloadHash: input.hasPayload ? hashPayload(input.payload) : undefined,
    payloadHashAlgorithm: "sha256:stable-json",
    resumePolicy: "standalone_or_rejudge",
  };
}

export function normalizeContextDependency(value: unknown, fallback: ContextDependency = "unknown"): ContextDependency {
  if (value === "none" || value === "run-context" || value === "unknown") return value;
  return fallback;
}

export interface ResumeDeps {
  recheckPolicy: (actionName: string) => Tier;
  issueToken: (actionName: string, at: number) => { token: string; issuedAt: number };
  execute: (actionName: string, payload: unknown, token: string) => void;
  rejudge: (taskId: string, at: number, originCardId: string) => void;
}

export class GenericAgentResumeCoordinator {
  private cards = new Map<string, GuardCard>();
  private seq = 0;
  readonly issuedTokens: { actionName: string; issuedAt: number }[] = [];
  readonly executions: { actionName: string; cardId: string }[] = [];
  readonly rejudged: { taskId: string; originCardId: string }[] = [];

  constructor(private deps: ResumeDeps) {}

  createGuardCard(input: {
    runId: string;
    taskId: string;
    actionName: string;
    payload: unknown;
    contextDependency: ContextDependency;
    now: number;
    ttlMs?: number;
  }): GuardCard {
    const card: GuardCard = {
      id: `gcard-${++this.seq}`,
      taskId: input.taskId,
      runId: input.runId,
      actionName: input.actionName,
      payloadHash: hashPayload(input.payload),
      contextDependency: input.contextDependency,
      createdAt: input.now,
      expiresAt: input.now + (input.ttlMs ?? DEFAULT_GENERIC_AGENT_APPROVAL_TTL_MS),
      status: "pending",
      source: "generic_agent_action_guard",
    };
    this.cards.set(card.id, card);
    return card;
  }

  get(id: string): GuardCard {
    const card = this.cards.get(id);
    if (!card) throw new Error(`Unknown Generic Agent guard card: ${id}`);
    return card;
  }

  approve(cardId: string): void {
    const card = this.get(cardId);
    if (card.status === "pending") card.status = "approved";
  }

  resume(cardId: string, currentPayload: unknown, now: number): ResumeResult {
    const card = this.get(cardId);

    if (card.status === "resumed") return "already-resumed";

    if (card.status === "expired" || now > card.expiresAt) {
      if (card.status !== "expired") {
        card.status = "expired";
        this.routeToRejudge(card, now);
      }
      return "rejected-expired";
    }

    if (card.status !== "approved") {
      throw new Error("Generic Agent resume requires an approved guard card");
    }

    if (this.deps.recheckPolicy(card.actionName) === "BLOCK") {
      return "rejected-hard-block";
    }

    if (card.contextDependency !== "none") {
      card.status = "resumed";
      this.routeToRejudge(card, now);
      return "routed-to-rejudge";
    }

    if (hashPayload(currentPayload) !== card.payloadHash) {
      return "rejected-hash-mismatch";
    }

    const issued = this.deps.issueToken(card.actionName, now);
    this.issuedTokens.push({ actionName: card.actionName, issuedAt: issued.issuedAt });
    this.deps.execute(card.actionName, currentPayload, issued.token);
    this.executions.push({ actionName: card.actionName, cardId });
    card.status = "resumed";
    return "executed-standalone";
  }

  private routeToRejudge(card: GuardCard, at: number) {
    this.deps.rejudge(card.taskId, at, card.id);
    this.rejudged.push({ taskId: card.taskId, originCardId: card.id });
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
