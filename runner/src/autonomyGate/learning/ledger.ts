// learning/ledger.ts
// 액션 유형별 승인 통계 누적기.
// 베이지안 평활로 표본이 적을 때 과신을 막는다(소표본 → 보수적).

import type {
  ApprovalEvent,
  ConfidenceLedgerEntry,
  LearnerConfig,
} from "./types.js";

interface Counts {
  approved: number;
  rejected: number;
  revised: number;
  refIds: string[];
}

export class ConfidenceLedger {
  private byAction = new Map<string, Counts>();

  constructor(private config: LearnerConfig) {}

  /** 승인 이벤트 1건 반영 (append-only 의미: 카운트만 증가) */
  ingest(event: ApprovalEvent): void {
    const c = this.byAction.get(event.actionType) ?? {
      approved: 0,
      rejected: 0,
      revised: 0,
      refIds: [],
    };
    if (event.outcome === "approved") c.approved += 1;
    else if (event.outcome === "rejected") c.rejected += 1;
    else c.revised += 1;
    if (c.refIds.length < 50) c.refIds.push(event.refId);
    this.byAction.set(event.actionType, c);
  }

  entry(actionType: string): ConfidenceLedgerEntry {
    const c = this.byAction.get(actionType) ?? {
      approved: 0,
      rejected: 0,
      revised: 0,
      refIds: [],
    };
    const total = c.approved + c.rejected + c.revised;
    const k = this.config.smoothingStrength;
    // 평활: (승인 + 0.5*k) / (전체 + k). 사전확률 0.5에서 출발해 표본이 쌓일수록 실측에 수렴
    const smoothedConfidence = (c.approved + 0.5 * k) / (total + k);
    const rejectionRate = total > 0 ? (c.rejected + c.revised) / total : 1;
    const promotable =
      total >= this.config.minSamplesForPromotion &&
      smoothedConfidence >= this.config.promotionConfidenceThreshold &&
      rejectionRate <= this.config.maxRejectionRate;
    return {
      actionType,
      approvedCount: c.approved,
      rejectedCount: c.rejected,
      revisedCount: c.revised,
      total,
      smoothedConfidence,
      promotable,
    };
  }

  actionTypes(): string[] {
    return [...this.byAction.keys()];
  }

  all(): ConfidenceLedgerEntry[] {
    return this.actionTypes().map((a) => this.entry(a));
  }
}
