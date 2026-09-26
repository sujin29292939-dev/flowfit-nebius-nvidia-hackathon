// learning/promotion.ts
// Admin 전용 승격 API. 후보 → 활성으로 바꾸는 유일한 경로.
// 학습기는 후보만 만들고, 활성화는 반드시 사람(Admin)이 여기를 거친다.

import type { Rule } from "../policy/types.js";
import type { RuleStore } from "../policy/stores.js";
import type { CriteriaRegistry } from "../criteriaRegistry.js";
import type { RuleCandidate, PromotionProposal } from "./types.js";

export interface AdminActor {
  userId: string;
  /** Admin 권한 확인. false면 승격 거부 */
  isAdmin: boolean;
}

export interface PromotionResult {
  ok: boolean;
  reason?: string;
}

export class PromotionService {
  constructor(
    private rules: RuleStore,
    private registry: CriteriaRegistry,
  ) {}

  /**
   * 룰 후보를 candidate 룰로 등록 (아직 비활성).
   * 학습기 출력을 정책 레이어에 들이는 입구.
   */
  registerCandidate(candidate: RuleCandidate): Rule {
    const rule: Rule = {
      id: candidate.id,
      title: `학습 후보: ${candidate.actionType}`,
      scope: candidate.actionType,
      effect: candidate.proposedEffect,
      priority: 10,
      status: "candidate", // 비활성
      statement: candidate.statement,
      updatedBy: "rule-learner",
      updatedAt: candidate.createdAt,
    };
    this.rules.upsert(rule);
    return rule;
  }

  /** Admin이 candidate 룰을 active로 승격 */
  promoteRule(ruleId: string, actor: AdminActor): PromotionResult {
    if (!actor.isAdmin) return { ok: false, reason: "not_admin" };
    const rule = this.rules.list().find((r) => r.id === ruleId);
    if (!rule) return { ok: false, reason: "rule_not_found" };
    if (rule.status !== "candidate") return { ok: false, reason: "not_a_candidate" };
    rule.status = "active";
    rule.updatedBy = actor.userId;
    rule.updatedAt = new Date().toISOString();
    return { ok: true };
  }

  /**
   * Admin이 AUTO 승격 제안을 수락 → 자동 전송 기준 등록 + 활성화.
   * 제안의 autoAllowed는 false이므로, 여기서 명시적으로 true로 켠다.
   */
  acceptPromotion(proposal: PromotionProposal, actor: AdminActor): PromotionResult {
    if (!actor.isAdmin) return { ok: false, reason: "not_admin" };
    this.registry.upsertFromCard({
      ...proposal.suggestedCriterion,
      autoAllowed: true, // Admin이 명시적으로 켬
    });
    return { ok: true };
  }

  /** Admin이 거부 — 후보 비활성 유지(또는 disabled) */
  rejectRule(ruleId: string, actor: AdminActor): PromotionResult {
    if (!actor.isAdmin) return { ok: false, reason: "not_admin" };
    const ok = this.rules.setStatus(ruleId, "disabled");
    return ok ? { ok: true } : { ok: false, reason: "rule_not_found" };
  }
}
