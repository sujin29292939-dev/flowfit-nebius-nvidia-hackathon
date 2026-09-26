/**
 * autopilotTicker.ts
 * ------------------------------------------------------------------
 * 자율 루프의 마지막 고리.
 *   ticker 기상 → 커넥션마다 HealthProbe → 깨짐(down 전이) 감지 → rediscoverOnBreak 자동 트리거
 *
 * 설계:
 *   - probe는 커넥터별이 아니라 "kind별 일반" 함수. profile.healthPath 한 줄만 읽는다.
 *   - 커넥션 하나가 실패해도 나머지는 계속(격리).
 *   - 재발견은 "방금 down으로 전이한 순간"에만 트리거(스톰 방지). 정책은 주입 가능.
 *   - unauthed(자격증명 문제)는 재발견이 아니라 재인증 유도(스키마 깨짐이 아님).
 *
 * 배포 주의:
 *   서버리스는 상시 루프 불가 → 외부 크론이 /tick으로 runTick 호출, 또는 상시 워커.
 *   다중 인스턴스면 advisory lock으로 단일 ticker 보장(중복 probe/재발견 방지).
 * ------------------------------------------------------------------
 */
import { z } from "zod";
import {
  runHealthCheck,
  type Connection,
  type ConnectorDefinition,
  type HealthCheckDeps,
  type HealthProbe,
} from "./connectorResolver.js";
import { buildHttpCall } from "./connectorExecutor.js";
import {
  rediscoverOnBreak,
  type DiscoveryOutcome,
  type DiscoveryPorts,
} from "./connectorDiscovery.js";
import type { HealthState, MappingProfile } from "./connectorTypes.js";

type FetchFn = typeof fetch;

/* ==================================================================
 * 1. kind별 일반 HealthProbe — profile.healthPath로 실제 호출
 *    (커넥터마다 새로 짜지 않는다. 새 커넥터는 healthPath 한 줄만 있으면 끝)
 * ================================================================== */

export function makeMappingProfileProbe(
  getProfile: (connectorKey: string) => Promise<MappingProfile | undefined>,
  fetchFn: FetchFn = fetch,
): HealthProbe {
  return {
    async probe(conn: Connection, credential: string): Promise<boolean> {
      const profile = await getProfile(conn.connectorKey);
      if (!profile) return false; // 프로파일 없음 = 깨진 것으로 취급 → 재발견 유도
      const call = buildHttpCall(profile, credential, {
        method: profile.healthMethod,
        path: profile.healthPath,
      });
      try {
        const res = await fetchFn(call.url, { method: call.method, headers: call.headers });
        return res.status >= 200 && res.status < 300;
      } catch {
        return false;
      }
    },
  };
}

/* ==================================================================
 * 2. 이벤트 (append-only)
 * ================================================================== */

export const AutopilotEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TickStarted"), at: z.string(), due: z.number().int() }),
  z.object({ type: z.literal("HealthChecked"), at: z.string(), connectorKey: z.string(), state: z.string() }),
  z.object({ type: z.literal("Unauthed"), at: z.string(), connectorKey: z.string() }),
  z.object({ type: z.literal("BreakDetected"), at: z.string(), connectorKey: z.string() }),
  z.object({ type: z.literal("RediscoverTriggered"), at: z.string(), connectorKey: z.string() }),
  z.object({ type: z.literal("RediscoverSucceeded"), at: z.string(), connectorKey: z.string() }),
  z.object({ type: z.literal("RediscoverFailed"), at: z.string(), connectorKey: z.string(), reason: z.string() }),
  z.object({ type: z.literal("TickFinished"), at: z.string(), checked: z.number().int(), broken: z.number().int(), recovered: z.number().int() }),
]);
export type AutopilotEvent = z.infer<typeof AutopilotEventSchema>;

/* ==================================================================
 * 3. 의존성
 * ================================================================== */

export interface AutopilotDeps {
  /** 이번 틱에 점검할 커넥션 목록 (구현: next_check_at <= now 조회) */
  listDueConnections: (now: Date) => Promise<Connection[]>;
  /** runHealthCheck용 (probe / resolveCredential / persist) */
  health: HealthCheckDeps;
  /** 재발견 요청에 필요한 커넥터 정의 조회 (capability/label) */
  catalog: { get(connectorKey: string): ConnectorDefinition | undefined };
  /** credentialRef → 실제 토큰 (재발견 요청에 사용) */
  resolveCredential: (ref: string) => Promise<string>;
  /** rediscoverOnBreak를 감싼 실행기 (discovery 포트는 통합부가 닫아 넣음) */
  discoveryPorts: DiscoveryPorts;
  /** 재발견 성공 후 커넥션 health 초기화 (다음 틱에 재확인) */
  resetHealth: (conn: Connection, state: HealthState) => Promise<void>;
  /** 재발견 트리거 정책. 기본: 방금 down으로 전이한 경우만 */
  shouldRediscover?: (prev: HealthState, next: HealthState) => boolean;
  maxAttempts?: number;
  events: { emit(e: AutopilotEvent): Promise<void> };
  clock?: () => Date;
}

const defaultShouldRediscover = (prev: HealthState, next: HealthState): boolean =>
  next === "down" && prev !== "down";

/* ==================================================================
 * 4. 틱 — 한 번의 점검 사이클
 * ================================================================== */

export interface TickSummary {
  checked: number;
  broken: number;
  recovered: number;
}

export async function runTick(deps: AutopilotDeps): Promise<TickSummary> {
  const now = () => (deps.clock?.() ?? new Date()).toISOString();
  const nowDate = deps.clock?.() ?? new Date();
  const shouldRediscover = deps.shouldRediscover ?? defaultShouldRediscover;

  const due = await deps.listDueConnections(nowDate);
  await deps.events.emit({ type: "TickStarted", at: now(), due: due.length });

  let broken = 0;
  let recovered = 0;

  for (const conn of due) {
    // 격리: 한 커넥션 예외가 전체 틱을 멈추지 않게
    try {
      const prevState = conn.health.state;
      const updated = await runHealthCheck(conn, deps.health);
      const nextState = updated.health.state;
      await deps.events.emit({ type: "HealthChecked", at: now(), connectorKey: conn.connectorKey, state: nextState });

      // 자격증명 문제 → 재발견 아님, 재인증 유도
      if (nextState === "unauthed") {
        await deps.events.emit({ type: "Unauthed", at: now(), connectorKey: conn.connectorKey });
        continue;
      }

      if (!shouldRediscover(prevState, nextState)) continue;

      // 여기부터 깨짐 → 재발견
      broken++;
      await deps.events.emit({ type: "BreakDetected", at: now(), connectorKey: conn.connectorKey });

      const def = deps.catalog.get(conn.connectorKey);
      if (!def || def.provides.length === 0) {
        await deps.events.emit({ type: "RediscoverFailed", at: now(), connectorKey: conn.connectorKey, reason: "카탈로그 정의/능력 없음" });
        continue;
      }

      const credential = await deps.resolveCredential(conn.credentialRef).catch(() => null);
      if (credential === null) {
        await deps.events.emit({ type: "RediscoverFailed", at: now(), connectorKey: conn.connectorKey, reason: "자격증명 해석 실패" });
        continue;
      }

      await deps.events.emit({ type: "RediscoverTriggered", at: now(), connectorKey: conn.connectorKey });
      const outcome: DiscoveryOutcome = await rediscoverOnBreak(
        {
          companyId: conn.companyId,
          serviceName: def.label,
          connectorKey: conn.connectorKey,
          capability: def.provides[0], // 단순화: 주 능력 1개. 다능력은 능력별 프로파일로 확장
          kind: conn.kind,
          credential,
          maxAttempts: deps.maxAttempts ?? 4,
        },
        deps.discoveryPorts,
      );

      if (outcome.ok) {
        // 재발견 성공 → health 초기화, 다음 틱에 재확인 (쓰기성은 SHADOW 승인 대기 상태로 고정됨)
        await deps.resetHealth(updated, "unknown");
        recovered++;
        await deps.events.emit({ type: "RediscoverSucceeded", at: now(), connectorKey: conn.connectorKey });
      } else {
        await deps.events.emit({ type: "RediscoverFailed", at: now(), connectorKey: conn.connectorKey, reason: outcome.reason });
      }
    } catch (e) {
      await deps.events.emit({ type: "RediscoverFailed", at: now(), connectorKey: conn.connectorKey, reason: `예외: ${(e as Error).message}` });
    }
  }

  await deps.events.emit({ type: "TickFinished", at: now(), checked: due.length, broken, recovered });
  return { checked: due.length, broken, recovered };
}

/* ==================================================================
 * 5. 루프 구동 — 상시 워커용. 서버리스면 이 대신 /tick 엔드포인트가 runTick 호출.
 * ================================================================== */

export interface LoopHandle {
  stop(): void;
}

export function startAutopilotLoop(deps: AutopilotDeps, intervalMs: number): LoopHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const loop = async () => {
    if (stopped) return;
    try {
      await runTick(deps);
    } catch {
      // 틱 전체 실패도 루프는 계속
    }
    if (!stopped) {
      // 지터: 동시 폭주 방지 (±10%)
      const jitter = intervalMs * (0.9 + Math.random() * 0.2);
      timer = setTimeout(loop, jitter);
    }
  };

  timer = setTimeout(loop, 0);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
