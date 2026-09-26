// criteriaRegistry.ts
// 자동 전송 "따 기준"의 저장소.
// 채팅의 ai_card_auto_criteria 카드(autoAllowed + keywords)가 그대로 여기에 등록된다.
// Admin이 add_auto_criteria 버튼을 누르면 upsert, hold면 등록 안 함.

import type { GateInput } from "./types.js";

export interface AutoCriterion {
  criterionId: string;
  title: string;
  /** false면 매칭돼도 자동 전송 안 함 (사람이 켜야 켜짐) */
  autoAllowed: boolean;
  keywords: string[];
  /** 특정 액션 유형에만 한정하고 싶을 때 */
  actionType?: string;
}

export interface CriterionMatch {
  criterion: AutoCriterion;
  matchedKeywords: string[];
}

export class CriteriaRegistry {
  private items = new Map<string, AutoCriterion>();

  /** ai_card_auto_criteria payload를 그대로 받아 등록 */
  upsertFromCard(payload: {
    criterionId: string;
    criterionTitle: string;
    autoAllowed: boolean;
    keywords: string[];
    actionType?: string;
  }): void {
    this.items.set(payload.criterionId, {
      criterionId: payload.criterionId,
      title: payload.criterionTitle,
      autoAllowed: payload.autoAllowed,
      keywords: payload.keywords ?? [],
      actionType: payload.actionType,
    });
  }

  upsert(c: AutoCriterion): void {
    this.items.set(c.criterionId, c);
  }

  remove(criterionId: string): void {
    this.items.delete(criterionId);
  }

  list(): AutoCriterion[] {
    return [...this.items.values()];
  }

  /**
   * 입력 텍스트/액션을 활성(autoAllowed) 기준과 대조.
   * 첫 매칭 기준을 돌려준다. 매칭 없으면 null → 사람 검토.
   */
  match(input: GateInput): CriterionMatch | null {
    const haystack = `${input.text} ${input.action} ${input.actionType}`.toLowerCase();
    for (const c of this.items.values()) {
      if (!c.autoAllowed) continue;
      if (c.actionType && c.actionType !== input.actionType) continue;
      const hits = c.keywords.filter((k) => k && haystack.includes(k.toLowerCase()));
      if (hits.length > 0) return { criterion: c, matchedKeywords: hits };
    }
    return null;
  }
}
