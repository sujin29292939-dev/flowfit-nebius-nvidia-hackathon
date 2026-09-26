// learning/ruleLearner.ts
// 승인 이벤트 → (1) 룰 후보 제안 (2) AUTO 승격 후보 제안.
// 둘 다 "후보"일 뿐 자동 적용하지 않는다. Admin 승격은 promotion.ts가 담당.

import type { RiskLevel } from "../types.js";
import type {
  ApprovalEvent,
  RuleCandidate,
  PromotionProposal,
  LearnerConfig,
} from "./types.js";
import { ConfidenceLedger } from "./ledger.js";

let candSeq = 0;

export class RuleLearner {
  readonly ledger: ConfidenceLedger;
  /** 액션 유형별 누적 키워드 (후보·승격 기준 생성용) */
  private keywords = new Map<string, Set<string>>();
  private events: ApprovalEvent[] = [];

  constructor(private config: LearnerConfig) {
    this.ledger = new ConfidenceLedger(config);
  }

  /** 승인 이벤트 1건 학습 (event-first: 읽어서 통계화) */
  learn(event: ApprovalEvent): void {
    this.events.push(event);
    this.ledger.ingest(event);
    if (event.context.matchedKeywords?.length) {
      const set = this.keywords.get(event.actionType) ?? new Set<string>();
      event.context.matchedKeywords.forEach((k) => set.add(k));
      this.keywords.set(event.actionType, set);
    }
  }

  /**
   * 룰 후보 제안. 표본이 충분하고 반려율이 낮은 액션 유형에 대해,
   * "force_review 완화" 또는 "cap_risk 조정"을 후보로 제안한다.
   */
  proposeCandidates(): RuleCandidate[] {
    const out: RuleCandidate[] = [];
    for (const e of this.ledger.all()) {
      if (e.total < this.config.minSamplesForCandidate) continue;
      const rejectionRate = e.total > 0 ? (e.rejectedCount + e.revisedCount) / e.total : 1;
      if (rejectionRate > this.config.maxRejectionRate) continue;

      candSeq += 1;
      // 안전한 방향의 후보만: 위험등급 상한을 명시(cap_risk).
      // 신뢰도가 높을수록 더 관대한 상한을 제안하지만, 최종 활성화는 Admin.
      const max: RiskLevel = e.smoothedConfidence >= 0.95 ? "medium" : "low";
      out.push({
        id: `cand-${Date.now()}-${candSeq}`,
        actionType: e.actionType,
        proposedEffect: { kind: "cap_risk", max },
        statement: `${e.actionType}: 승인 ${e.approvedCount}/${e.total}건 누적. 위험등급 ${max} 이하 정형 처리 후보.`,
        evidence: {
          approvedCount: e.approvedCount,
          rejectedCount: e.rejectedCount,
          revisedCount: e.revisedCount,
          total: e.total,
          approvalRate: e.total > 0 ? e.approvedCount / e.total : 0,
          sampleRefIds: [],
        },
        createdAt: new Date().toISOString(),
      });
    }
    return out;
  }

  /**
   * AUTO 승격 후보. 신뢰도 원장이 promotable인 액션 유형에 대해
   * 자동 전송 기준을 제안한다. autoAllowed는 항상 false — Admin이 켜야 켜진다.
   */
  proposePromotions(): PromotionProposal[] {
    const out: PromotionProposal[] = [];
    for (const e of this.ledger.all()) {
      if (!e.promotable) continue;
      const kws = [...(this.keywords.get(e.actionType) ?? [])];
      out.push({
        actionType: e.actionType,
        reason: `누적 ${e.total}건, 평활 신뢰도 ${e.smoothedConfidence.toFixed(3)} ≥ 임계 ${this.config.promotionConfidenceThreshold}`,
        ledger: e,
        suggestedCriterion: {
          criterionId: `auto-${e.actionType}`,
          criterionTitle: `${e.actionType} 자동 전송 (학습 제안)`,
          autoAllowed: false, // Admin이 켜야 활성
          keywords: kws,
          actionType: e.actionType,
        },
        createdAt: new Date().toISOString(),
      });
    }
    return out;
  }

  /** 진단용 */
  eventCount(): number {
    return this.events.length;
  }
}
