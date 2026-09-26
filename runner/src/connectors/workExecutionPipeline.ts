/**
 * workExecutionPipeline.ts
 * ------------------------------------------------------------------
 * 실제 업무 실행 경로.
 *   intent → resolve(커넥터 선택) → actionGuard(권한) → autonomyGate(자동/승인) → execute(실제 호출)
 *
 * 게이트 순서가 곧 안전 모델이다:
 *   1) resolve   : 어떤 커넥터로?            (없으면 ask_connect / manual)
 *   2) actionGuard: 그 행동을 그 도구로 해도 되나? (권한 차단)
 *   3) autonomyGate: 지금 자동으로 실행해도 되나? (AUTO / 승인필요 / SHADOW)
 *   4) execute   : 통과한 경우에만 실제 HTTP 호출
 *
 * SHADOW는 실제 호출을 하지 않고 "할 뻔한 것"만 기록한다(검증·학습용).
 * 모든 분기는 append-only 이벤트로 남긴다.
 *
 * 기존 코드 연결:
 *   - ActionGuardPort  ← 기존 actionGuard.ts (행동→도구 권한 Resolver)
 *   - AutonomyGatePort ← 기존 autonomyGate (SHADOW/ASSIST/AUTO + kill switch)
 *   - approvals        ← 기존 approvals (승인함 카드 생성)
 *   둘 다 시그니처가 다르면 이 포트에 맞춰 얇은 어댑터만 끼우면 된다.
 * ------------------------------------------------------------------
 */
import { z } from "zod";
import type { Capability, MappingProfile } from "./connectorTypes.js";
import {
  ConnectorResolver,
  INTENT_CAPABILITY,
  WorkIntent,
  type ResolvedConnector,
} from "./connectorResolver.js";
import { executeViaConnector, type HttpPort, type ExecuteResult } from "./connectorExecutor.js";

/* ==================================================================
 * 1. 게이트 포트 (기존 모듈을 감싸는 인터페이스)
 * ================================================================== */

/** 기존 actionGuard.ts: 이 행동을 이 커넥터(도구)로 수행할 권한이 있나? */
export interface ActionGuardPort {
  check(args: {
    intent: WorkIntent;
    capability: Capability;
    connectorKey: string;
  }): Promise<{ allowed: boolean; reason?: string }>;
}

export const AutonomyDecision = z.enum(["AUTO", "ASSIST", "SHADOW", "BLOCK"]);
export type AutonomyDecision = z.infer<typeof AutonomyDecision>;

/** 기존 autonomyGate: 지금 자동 실행 가능한가? kill switch 포함. */
export interface AutonomyGatePort {
  evaluate(args: {
    companyId: string;
    intent: WorkIntent;
    capability: Capability;
    connectorKey: string;
    payload?: Record<string, unknown>;
  }): Promise<{ decision: AutonomyDecision; reason?: string }>;
}

/** 기존 approvals: 승인함 카드 생성 → 승인 ID 반환 */
export interface ApprovalsPort {
  createCard(args: {
    companyId: string;
    intent: WorkIntent;
    connectorKey: string;
    payload?: Record<string, unknown>;
    proposedCall: { method: string; baseUrl: string; path: string };
  }): Promise<{ approvalId: string }>;
}

/* ==================================================================
 * 2. 이벤트 (append-only)
 * ================================================================== */

export const WorkEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("WorkRequested"), at: z.string(), intent: z.string() }),
  z.object({ type: z.literal("ResolveFailed"), at: z.string(), reason: z.string() }),
  z.object({ type: z.literal("ActionBlocked"), at: z.string(), reason: z.string() }),
  z.object({ type: z.literal("AutonomyDecided"), at: z.string(), decision: AutonomyDecision, reason: z.string().optional() }),
  z.object({ type: z.literal("ShadowRecorded"), at: z.string(), connectorKey: z.string() }),
  z.object({ type: z.literal("ApprovalRequested"), at: z.string(), approvalId: z.string() }),
  z.object({ type: z.literal("Executed"), at: z.string(), connectorKey: z.string(), status: z.number(), ok: z.boolean() }),
]);
export type WorkEvent = z.infer<typeof WorkEventSchema>;

/* ==================================================================
 * 3. 의존성 / 결과
 * ================================================================== */

export interface PipelineDeps {
  resolver: ConnectorResolver;
  actionGuard: ActionGuardPort;
  autonomyGate: AutonomyGatePort;
  approvals: ApprovalsPort;
  http: HttpPort;
  /** connectorKey → 고정된 MappingProfile 조회 (카탈로그) */
  getProfile: (connectorKey: string) => Promise<MappingProfile | undefined>;
  events: { emit(e: WorkEvent): Promise<void> };
  clock?: () => Date;
}

export const WorkRequestSchema = z.object({
  companyId: z.string(),
  intent: z.custom<WorkIntent>(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type WorkRequest = { companyId: string; intent: WorkIntent; payload?: Record<string, unknown> };

export type WorkResult =
  | { status: "executed"; result: ExecuteResult; connectorKey: string }
  | { status: "shadow"; connectorKey: string; proposed: { method: string; url: string } }
  | { status: "needs_approval"; approvalId: string; connectorKey: string }
  | { status: "blocked"; reason: string }
  | { status: "no_connector"; fallback: "manual" | "ask_connect" };

/* ==================================================================
 * 4. 파이프라인
 * ================================================================== */

export async function runWork(req: WorkRequest, deps: PipelineDeps): Promise<WorkResult> {
  const now = () => (deps.clock?.() ?? new Date()).toISOString();
  const capability = INTENT_CAPABILITY[req.intent];

  await deps.events.emit({ type: "WorkRequested", at: now(), intent: req.intent });

  // 1) resolve — 어떤 커넥터로?
  const resolved = await deps.resolver.resolve(req.companyId, req.intent);
  if (!resolved.ok) {
    await deps.events.emit({ type: "ResolveFailed", at: now(), reason: resolved.reason });
    const fallback = resolved.fallback === "ask_connect" ? "ask_connect" : "manual";
    return { status: "no_connector", fallback };
  }
  const conn: ResolvedConnector = resolved.chosen;

  // 2) actionGuard — 권한
  const guard = await deps.actionGuard.check({
    intent: req.intent,
    capability,
    connectorKey: conn.connectorKey,
  });
  if (!guard.allowed) {
    const reason = guard.reason ?? "권한 없음";
    await deps.events.emit({ type: "ActionBlocked", at: now(), reason });
    return { status: "blocked", reason };
  }

  // 3) autonomyGate — 자동/승인/SHADOW/차단
  const gate = await deps.autonomyGate.evaluate({
    companyId: req.companyId,
    intent: req.intent,
    capability,
    connectorKey: conn.connectorKey,
    payload: req.payload,
  });
  await deps.events.emit({ type: "AutonomyDecided", at: now(), decision: gate.decision, reason: gate.reason });

  if (gate.decision === "BLOCK") {
    return { status: "blocked", reason: gate.reason ?? "autonomyGate 차단" };
  }

  const profile = await deps.getProfile(conn.connectorKey);
  if (!profile) {
    // 발견 전 커넥터 — 실행 불가 (executor도 거부하지만 여기서 명확히 끊는다)
    await deps.events.emit({ type: "ActionBlocked", at: now(), reason: "MappingProfile 없음(미발견)" });
    return { status: "blocked", reason: "MappingProfile 없음 — discoverConnector 선행 필요" };
  }

  // SHADOW: 실제 호출 없이 "할 뻔한 것"만 기록
  if (gate.decision === "SHADOW") {
    await deps.events.emit({ type: "ShadowRecorded", at: now(), connectorKey: conn.connectorKey });
    return {
      status: "shadow",
      connectorKey: conn.connectorKey,
      proposed: {
        method: profile.endpoint.method,
        url: new URL(profile.endpoint.path, profile.baseUrl).toString(),
      },
    };
  }

  // ASSIST: 사람 승인 카드 생성 후 대기
  if (gate.decision === "ASSIST") {
    const { approvalId } = await deps.approvals.createCard({
      companyId: req.companyId,
      intent: req.intent,
      connectorKey: conn.connectorKey,
      payload: req.payload,
      proposedCall: { method: profile.endpoint.method, baseUrl: profile.baseUrl, path: profile.endpoint.path },
    });
    await deps.events.emit({ type: "ApprovalRequested", at: now(), approvalId });
    return { status: "needs_approval", approvalId, connectorKey: conn.connectorKey };
  }

  // 4) AUTO: 실제 실행
  const result = await executeViaConnector(conn, profile, deps.http, req.payload);
  await deps.events.emit({
    type: "Executed",
    at: now(),
    connectorKey: conn.connectorKey,
    status: result.status,
    ok: result.ok,
  });
  return { status: "executed", result, connectorKey: conn.connectorKey };
}

/* ==================================================================
 * 5. 승인 후 실행 — 승인함 카드가 승인되면 호출
 *    (autonomyGate를 다시 거치지 않고, 사람 승인이 그 자리를 대신한다)
 * ================================================================== */

export async function runApprovedWork(
  args: { companyId: string; intent: WorkIntent; resolved: ResolvedConnector; payload?: Record<string, unknown> },
  deps: PipelineDeps,
): Promise<WorkResult> {
  const now = () => (deps.clock?.() ?? new Date()).toISOString();
  const profile = await deps.getProfile(args.resolved.connectorKey);
  if (!profile) {
    return { status: "blocked", reason: "MappingProfile 없음 — 발견 선행 필요" };
  }
  const result = await executeViaConnector(args.resolved, profile, deps.http, args.payload);
  await deps.events.emit({
    type: "Executed",
    at: now(),
    connectorKey: args.resolved.connectorKey,
    status: result.status,
    ok: result.ok,
  });
  return { status: "executed", result, connectorKey: args.resolved.connectorKey };
}
