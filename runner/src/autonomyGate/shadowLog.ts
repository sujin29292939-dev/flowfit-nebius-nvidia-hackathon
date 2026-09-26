// shadowLog.ts
// SHADOW 모드 증거 수집기.
// 게이트가 "보냈을 것"과 사람이 "실제 내린 결정"을 대조해 오발송률을 측정한다.
// 이 보고서가 라이브(AUTO) 전환의 근거가 된다.

import type { GateDecision, GateInput } from "./types.js";

type HumanOutcome = "approved" | "rejected" | "revised";

interface ShadowRecord {
  refId: string;
  companyId: string;
  actionType: string;
  wouldAutoSend: boolean;
  decision: GateDecision;
  humanOutcome?: HumanOutcome;
  recordedAt: string;
}

export interface ShadowReport {
  total: number;
  resolved: number;
  wouldAuto: number;
  /** wouldAuto 중 사람이 실제 승인 → 게이트 판단 일치 */
  agreements: number;
  /** wouldAuto 인데 사람이 반려/수정 → 위험한 오판 */
  falseAuto: number;
  /** wouldAuto & resolved 중 일치 비율 */
  agreementRate: number;
  /** wouldAuto & resolved 중 오판 비율 (라이브 전환 게이트 지표) */
  falseAutoRate: number;
}

export class ShadowLog {
  private records = new Map<string, ShadowRecord>();

  record(input: GateInput, decision: GateDecision): void {
    this.records.set(input.refId, {
      refId: input.refId,
      companyId: input.companyId,
      actionType: input.actionType,
      wouldAutoSend: decision.outcome === "AUTO_SEND",
      decision,
      recordedAt: new Date().toISOString(),
    });
  }

  /** 나중에 사람이 그 건을 어떻게 처리했는지 되먹임 */
  recordHumanOutcome(refId: string, humanOutcome: HumanOutcome): void {
    const r = this.records.get(refId);
    if (r) r.humanOutcome = humanOutcome;
  }

  report(): ShadowReport {
    const all = [...this.records.values()];
    const resolved = all.filter((r) => r.humanOutcome !== undefined);
    const wouldAutoResolved = resolved.filter((r) => r.wouldAutoSend);
    const agreements = wouldAutoResolved.filter((r) => r.humanOutcome === "approved").length;
    const falseAuto = wouldAutoResolved.filter(
      (r) => r.humanOutcome === "rejected" || r.humanOutcome === "revised",
    ).length;
    const denom = wouldAutoResolved.length || 1;
    return {
      total: all.length,
      resolved: resolved.length,
      wouldAuto: all.filter((r) => r.wouldAutoSend).length,
      agreements,
      falseAuto,
      agreementRate: agreements / denom,
      falseAutoRate: falseAuto / denom,
    };
  }
}
