// autonomyGate.ts
// 승인 요청 생성 직전에 자동 전송 가능 여부를 판단하는 Gate 본체.
//
// 흐름:
//  1) 하드 블록 검사: owner_only, high risk, 비가역, 미확인 수신자, 금지 액션, 수신자별 한도, kill switch
//  2) 기준 매칭 + 신뢰도 + 위험등급으로 AUTO_SEND/HUMAN_REVIEW 판단
//  3) SHADOW/ASSIST에서는 실제 전송하지 않고, AUTO에서만 dispatch queue에 넣는다.

import { isDatabaseConfigured, sql } from "../db/client.js";
import type {
  GateConfig,
  GateDecision,
  GateInput,
  GateResult,
} from "./types.js";
import { CriteriaRegistry } from "./criteriaRegistry.js";
import { DispatchQueue, type DispatchPayload } from "./dispatchQueue.js";
import { ShadowLog } from "./shadowLog.js";

/** 수신자별 일일 자동 전송 한도 추적. DB가 있으면 서버 재시작 후에도 유지된다. */
class RateLimiter {
  private counts = new Map<string, number>();
  private loaded = new Set<string>();

  private day(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
  }

  private key(companyId: string, recipient: string, now: number): string {
    return `${companyId}:${recipient}:${this.day(now)}`;
  }

  async hydrate(companyId: string, recipient: string, now: number): Promise<void> {
    const key = this.key(companyId, recipient, now);
    if (this.loaded.has(key)) return;

    if (!isDatabaseConfigured()) {
      this.loaded.add(key);
      return;
    }

    try {
      const rows = await sql`
        SELECT sent_count
        FROM autonomy_daily_usage
        WHERE company_id = ${companyId}
          AND recipient_key = ${recipient}
          AND usage_date = ${this.day(now)}
        LIMIT 1
      `;
      this.counts.set(key, Number(rows[0]?.sent_count ?? 0));
    } catch (error) {
      console.error(`[AutonomyGate] daily rate usage lookup failed: ${String(error)}`);
      this.counts.set(key, Number.POSITIVE_INFINITY);
    }
    this.loaded.add(key);
  }

  exceeded(companyId: string, recipient: string, limit: number, now: number): boolean {
    return (this.counts.get(this.key(companyId, recipient, now)) ?? 0) >= limit;
  }

  async increment(companyId: string, recipient: string, now: number): Promise<void> {
    const key = this.key(companyId, recipient, now);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    this.loaded.add(key);

    if (!isDatabaseConfigured()) return;

    await sql`
      INSERT INTO autonomy_daily_usage (
        company_id,
        recipient_key,
        usage_date,
        sent_count,
        created_at,
        updated_at
      )
      VALUES (${companyId}, ${recipient}, ${this.day(now)}, 1, NOW(), NOW())
      ON CONFLICT (company_id, recipient_key, usage_date)
      DO UPDATE SET
        sent_count = autonomy_daily_usage.sent_count + 1,
        updated_at = NOW()
    `;
  }
}

export interface GateDeps {
  config: GateConfig;
  registry: CriteriaRegistry;
  queue: DispatchQueue;
  shadow: ShadowLog;
  /** GateInput을 실제 전송 명세로 변환한다. */
  buildDispatchPayload: (input: GateInput) => DispatchPayload;
}

/** 순수 판단 함수. 전송 부작용은 없다. */
export function evaluate(
  input: GateInput,
  registry: CriteriaRegistry,
  config: GateConfig,
  rate: RateLimiter,
  now: number,
): GateDecision {
  const decidedAt = new Date(now).toISOString();
  const match = registry.match(input);
  const criteriaMatch = !!match;
  const base = {
    matchedCriterionId: match?.criterion.criterionId,
    matchedKeywords: match?.matchedKeywords ?? [],
    scores: { confidence: input.confidence, criteriaMatch },
    decidedAt,
  };

  const blocked = hardBlock(input, config, rate, now);
  if (blocked) {
    return { outcome: "HUMAN_REVIEW", blockedBy: blocked, ...base };
  }

  if (!criteriaMatch) {
    return { outcome: "HUMAN_REVIEW", blockedBy: "no_matching_auto_criterion", ...base };
  }
  if (input.confidence < config.confidenceThreshold) {
    return { outcome: "HUMAN_REVIEW", blockedBy: "low_confidence", ...base };
  }
  if (!config.autoEligibleRisk.includes(input.riskLevel)) {
    return { outcome: "HUMAN_REVIEW", blockedBy: "risk_not_eligible", ...base };
  }

  return { outcome: "AUTO_SEND", ...base };
}

function hardBlock(
  input: GateInput,
  config: GateConfig,
  rate: RateLimiter,
  now: number,
): string | null {
  if (config.killSwitch) return "kill_switch";
  if (input.forceReview) return "ai_flagged_review";
  if (input.approvalPolicy === "owner_only") return "owner_only_policy";
  if (input.riskLevel === "high") return "high_risk";
  if (!input.reversible) return "irreversible_action";
  if (!input.recipientKnown) return "unknown_recipient";
  if (config.hardBlockActions.includes(input.actionType)) return "blocked_action_type";
  if (
    input.recipientKey &&
    rate.exceeded(input.companyId, input.recipientKey, config.perRecipientDailyLimit, now)
  ) {
    return "rate_limit";
  }
  return null;
}

export class AutonomyGate {
  private rate = new RateLimiter();
  constructor(private deps: GateDeps) {}

  /** Runner가 승인 요청 생성 직전에 호출하는 단일 진입점. */
  async run(input: GateInput, now: number = Date.now()): Promise<GateResult> {
    const { config, registry, queue, shadow, buildDispatchPayload } = this.deps;

    if (input.recipientKey) {
      await this.rate.hydrate(input.companyId, input.recipientKey, now);
    }

    const decision = evaluate(input, registry, config, this.rate, now);
    const mode = config.mode;

    // SHADOW: 실제 자동 전송하지 않고 "보냈을 것"만 기록한다.
    if (mode === "SHADOW") {
      shadow.record(input, decision);
      return { decision, effectiveOutcome: "HUMAN_REVIEW", shadowed: true, mode };
    }

    // ASSIST: 초안만 만들고 전송은 사람 검토로 넘긴다.
    if (mode === "ASSIST") {
      shadow.record(input, decision);
      return { decision, effectiveOutcome: "HUMAN_REVIEW", shadowed: false, mode };
    }

    // AUTO: Gate가 통과시킨 건만 실제 전송 큐에 넣는다.
    if (decision.outcome === "AUTO_SEND") {
      const payload = buildDispatchPayload(input);
      const dispatchId = queue.enqueue({
        companyId: input.companyId,
        refId: input.refId,
        actionType: input.actionType,
        payload,
        now,
      });
      if (input.recipientKey) {
        await this.rate.increment(input.companyId, input.recipientKey, now);
      }
      return { decision, effectiveOutcome: "AUTO_SEND", dispatchId, shadowed: false, mode };
    }

    return { decision, effectiveOutcome: "HUMAN_REVIEW", shadowed: false, mode };
  }
}

export { RateLimiter };
