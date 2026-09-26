/**
 * connectorResolver.ts
 * ------------------------------------------------------------------
 * 중앙 Connector Resolver — 기존 조각(staffChannelRouter / catalog /
 * runtime.resolveEnvCredential / actionGuard)을 묶는 단일 진입점.
 *
 * 원칙(autonomy-gate 컨벤션):
 *  - 모든 외부 형태는 Zod로 검증한다.
 *  - Resolver는 "선택(읽기)"만 한다. 실제 행동은 actionGuard → autonomyGate가 게이트한다.
 *  - DB/런타임 비의존: 저장소·자격증명·프로브는 포트(interface)로 주입한다(테스트 용이).
 *
 * 실제 repo에서는 아래 섹션을 파일로 분리 권장:
 *   capability.ts / connection.schema.ts / registry.ts / health.ts / resolver.ts
 * ------------------------------------------------------------------
 */
import { z } from "zod";
import {
  Capability,
  ConnectionKind,
  HealthState,
  MappingProfileSchema,
} from "./connectorTypes.js";

// 외부에서 connectorResolver만 import해도 쓰도록 재노출
export { Capability, ConnectionKind, HealthState, MappingProfileSchema };
export type { MappingProfile } from "./connectorTypes.js";

/* ==================================================================
 * 1. Capability 계층 — 업무(intent) ↔ 능력 ↔ 커넥터의 접착제
 *    (Capability/ConnectionKind/HealthState는 connectorTypes.ts에 단일 정의)
 * ================================================================== */

export const WorkIntent = z.enum([
  "register_order",
  "confirm_order",
  "create_quote",
  "track_shipment",
  "read_inventory",
  "check_payment",
  "confirm_with_staff",
  "read_inquiry",
  "reply_inquiry",
  "handle_complaint",
  "create_report",
  "create_automation",
]);
export type WorkIntent = z.infer<typeof WorkIntent>;

/** 업무유형 → 필요한 단일 능력. 선택 로직 전체가 이 표 하나에 압축된다. */
export const INTENT_CAPABILITY: Record<WorkIntent, Capability> = {
  register_order: "order.create",
  confirm_order: "order.confirm",
  create_quote: "quote.create",
  track_shipment: "shipment.track",
  read_inventory: "inventory.read",
  check_payment: "payment.check",
  confirm_with_staff: "staff.confirm",
  read_inquiry: "inquiry.read",
  reply_inquiry: "inquiry.reply",
  handle_complaint: "complaint.handle",
  create_report: "report.create",
  create_automation: "automation.create",
};

/* ==================================================================
 * 2. 스키마 — 카탈로그 / 연결 저장소 / 회사별 레지스트리
 * ================================================================== */

export const ConnectionKindSchema = ConnectionKind;
export const HealthStateSchema = HealthState;

/** catalog.ts가 채우는 커넥터 "정의". provides가 능력 태그(신규). */
export const ConnectorDefinitionSchema = z.object({
  key: z.string(), // "coupang" | "slack" | "cj_logistics" ...
  label: z.string(),
  kind: ConnectionKind,
  provides: z.array(Capability), // 이 커넥터가 제공하는 능력
  supportsPush: z.boolean().default(false), // resolve 시점 자동 판정 결과를 박아둠
  defaultPriority: z.number().int().default(100), // 낮을수록 우선
  mappingProfile: MappingProfileSchema.optional(), // ← 발견 루프 산출물과 동일 타입으로 연결
});
export type ConnectorDefinition = z.infer<typeof ConnectorDefinitionSchema>;

/** 실제 인증/설정 저장소. credentialRef는 runtime.resolveEnvCredential로 해석. */
export const ConnectionSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  connectorKey: z.string(), // → ConnectorDefinition.key
  kind: ConnectionKind,
  credentialRef: z.string(), // "env:SLACK_BOT_TOKEN" 등. 절대 평문 저장 금지.
  config: z.record(z.string(), z.unknown()).default({}),
  supportsPush: z.boolean().default(false),
  health: z
    .object({
      state: HealthState.default("unknown"),
      lastOkAt: z.string().nullable().default(null),
      failCount: z.number().int().default(0),
      checkedAt: z.string().nullable().default(null),
    })
    .default({ state: "unknown", lastOkAt: null, failCount: 0, checkedAt: null }),
});
export type Connection = z.infer<typeof ConnectionSchema>;

/** 회사가 "켜 둔" 커넥터 + 회사별 우선순위 오버라이드. */
export const CompanyConnectorSchema = z.object({
  companyId: z.string(),
  connectorKey: z.string(),
  connectionId: z.string(), // → Connection.id
  enabled: z.boolean().default(true),
  priorityOverride: z.number().int().nullable().default(null),
  capabilitiesEnabled: z.array(Capability).optional(), // 일부 능력만 허용 가능
});
export type CompanyConnector = z.infer<typeof CompanyConnectorSchema>;

/* ==================================================================
 * 3. 결과 타입
 * ================================================================== */

export interface ResolvedConnector {
  connectorKey: string;
  connectionId: string;
  capability: Capability;
  kind: ConnectionKind;
  credential: string; // 해석된 실제 토큰/URL — 로그·URL 노출 금지
  config: Record<string, unknown>;
  supportsPush: boolean;
}

export type ResolveOutcome =
  | { ok: true; chosen: ResolvedConnector; alternatives: ResolvedConnector[] }
  | {
      ok: false;
      reason: "no_connector" | "all_unhealthy" | "unauthed";
      capability: Capability;
      fallback: "manual" | "ask_connect";
    };

/* ==================================================================
 * 4. 주입 포트 — DB/런타임 비의존
 * ================================================================== */

export interface ResolverDeps {
  catalog: {
    get(key: string): ConnectorDefinition | undefined;
    all(): ConnectorDefinition[];
  };
  registry: {
    listByCompany(companyId: string): Promise<CompanyConnector[]>;
  };
  connections: {
    get(id: string): Promise<Connection | null>;
  };
  /** runtime.resolveEnvCredential 래핑 */
  resolveCredential: (ref: string) => Promise<string>;
}

const UNHEALTHY: ReadonlySet<HealthState> = new Set(["down", "unauthed"]);

/* ==================================================================
 * 5. 중앙 Resolver
 * ================================================================== */

export class ConnectorResolver {
  constructor(private readonly deps: ResolverDeps) {}

  async resolve(
    companyId: string,
    intent: WorkIntent,
  ): Promise<ResolveOutcome> {
    const capability = INTENT_CAPABILITY[intent];

    // 1. 회사가 켜 둔 커넥터 중, 이 능력을 제공하는 후보 수집
    const registered = await this.deps.registry.listByCompany(companyId);
    const candidates: Array<{
      reg: CompanyConnector;
      def: ConnectorDefinition;
      conn: Connection;
    }> = [];

    for (const reg of registered) {
      if (!reg.enabled) continue;
      const def = this.deps.catalog.get(reg.connectorKey);
      if (!def || !def.provides.includes(capability)) continue;
      if (reg.capabilitiesEnabled && !reg.capabilitiesEnabled.includes(capability))
        continue;
      const conn = await this.deps.connections.get(reg.connectionId);
      if (!conn) continue;
      candidates.push({ reg, def, conn });
    }

    if (candidates.length === 0) {
      return { ok: false, reason: "no_connector", capability, fallback: "ask_connect" };
    }

    // 2. health 필터 (down/unauthed 제외)
    const healthy = candidates.filter((c) => !UNHEALTHY.has(c.conn.health.state));
    if (healthy.length === 0) {
      const unauthed = candidates.some((c) => c.conn.health.state === "unauthed");
      return {
        ok: false,
        reason: unauthed ? "unauthed" : "all_unhealthy",
        capability,
        fallback: unauthed ? "ask_connect" : "manual",
      };
    }

    // 3. 우선순위 정렬 (override > catalog default, degraded는 후순위)
    const ranked = healthy.sort((a, b) => this.score(a) - this.score(b));

    // 4. 자격증명 해석
    const toResolved = async (c: (typeof ranked)[number]): Promise<ResolvedConnector> => ({
      connectorKey: c.def.key,
      connectionId: c.conn.id,
      capability,
      kind: c.conn.kind,
      credential: await this.deps.resolveCredential(c.conn.credentialRef),
      config: c.conn.config,
      supportsPush: c.conn.supportsPush,
    });

    const chosen = await toResolved(ranked[0]);
    const alternatives = await Promise.all(ranked.slice(1).map(toResolved));
    return { ok: true, chosen, alternatives };
  }

  private score(c: {
    reg: CompanyConnector;
    def: ConnectorDefinition;
    conn: Connection;
  }): number {
    const base = c.reg.priorityOverride ?? c.def.defaultPriority;
    const penalty = c.conn.health.state === "degraded" ? 1000 : 0;
    return base + penalty; // 낮을수록 우선
  }
}

/* ==================================================================
 * 6. staffChannelRouter 흡수
 *   기존 우선순위(slack→teams→kakao_work→email→webhook→sms→telegram→manual)는
 *   staff.confirm 제공 커넥터들의 catalog.defaultPriority로 인코딩하면
 *   selectRoute()와 동일 동작이 resolve()로 재현된다.
 * ================================================================== */

export function resolveStaffChannel(
  resolver: ConnectorResolver,
  companyId: string,
): Promise<ResolveOutcome> {
  return resolver.resolve(companyId, "confirm_with_staff");
}

/* ==================================================================
 * 7. Health Check — autopilot ticker가 주기 실행
 * ================================================================== */

export interface HealthProbe {
  /** 커넥터별 가벼운 test call. 성공/실패만 반환. */
  probe(conn: Connection, credential: string): Promise<boolean>;
}

export interface HealthCheckDeps {
  resolveCredential: (ref: string) => Promise<string>;
  probe: HealthProbe;
  persist: (c: Connection) => Promise<void>;
  now?: () => Date;
}

export async function runHealthCheck(
  conn: Connection,
  deps: HealthCheckDeps,
): Promise<Connection> {
  const checkedAt = (deps.now?.() ?? new Date()).toISOString();

  let credential: string;
  try {
    credential = await deps.resolveCredential(conn.credentialRef);
  } catch {
    const updated: Connection = {
      ...conn,
      health: {
        ...conn.health,
        state: "unauthed",
        failCount: conn.health.failCount + 1,
        checkedAt,
      },
    };
    await deps.persist(updated);
    return updated;
  }

  const ok = await deps.probe.probe(conn, credential).catch(() => false);
  const failCount = ok ? 0 : conn.health.failCount + 1;
  const state: HealthState = ok ? "healthy" : failCount >= 3 ? "down" : "degraded";

  const updated: Connection = {
    ...conn,
    health: {
      state,
      lastOkAt: ok ? checkedAt : conn.health.lastOkAt,
      failCount,
      checkedAt,
    },
  };
  await deps.persist(updated);
  return updated;
}
