// settings/schemas.ts
// 모듈별 운영 설정 Zod 스키마.
// 각 모듈은 (1) 값 스키마 (2) 검증된 값 → 룰 변환을 함께 정의한다(설정=룰 일원화).

import { z } from "zod";
import type { Rule } from "../policy/types.js";

// ── 공통 ─────────────────────────────────────────────────────────────────────

const positiveInt = z.number().int().positive();
const nonNegInt = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);

function rule(partial: Omit<Rule, "updatedBy" | "updatedAt" | "status" | "priority"> & {
  priority?: number;
}): Rule {
  return {
    priority: partial.priority ?? 50,
    status: "active",
    updatedBy: "settings",
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

// ── 미수금 (receivables) ──────────────────────────────────────────────────────

export const receivablesSchema = z
  .object({
    /** P1(긴급) 분류 경과일수 */
    p1ThresholdDays: positiveInt,
    /** 자동 리마인더 허용 금액 상한 (원) */
    autoReminderAmountCap: positiveInt,
    /** 리마인더 최대 재발송 횟수 */
    maxReminderCount: nonNegInt,
    /** 자동 리마인더 활성 여부 */
    autoReminderEnabled: z.boolean(),
  })
  .strict();

export type ReceivablesValues = z.infer<typeof receivablesSchema>;

export function receivablesRules(v: ReceivablesValues): Rule[] {
  const rules: Rule[] = [
    rule({
      id: "set-receivables-amount-cap",
      title: "미수금 자동 리마인더 금액 상한",
      scope: "payment_report",
      effect: { kind: "max_amount", amount: v.autoReminderAmountCap },
      statement: `미수금 리마인더 자동 발송은 ${v.autoReminderAmountCap.toLocaleString()}원 이하만 허용.`,
    }),
  ];
  if (!v.autoReminderEnabled) {
    rules.push(
      rule({
        id: "set-receivables-disabled",
        title: "미수금 자동 리마인더 비활성",
        scope: "payment_report",
        effect: { kind: "force_review", reason: "미수금 자동 리마인더가 비활성 상태" },
        priority: 90,
        statement: "미수금 리마인더는 현재 사람 검토 필수.",
      }),
    );
  }
  return rules;
}

// ── 납기 (delivery) ────────────────────────────────────────────────────────────

export const deliverySchema = z
  .object({
    /** 납기 임박 알림 시작 D-N */
    alertLeadDays: positiveInt,
    /** 자동 납기 안내 허용 위험등급 상한 */
    autoAlertMaxRisk: z.enum(["low", "medium", "high"]),
    /** 주소 누락 시 강제 검토 */
    requireDeliveryAddress: z.boolean(),
  })
  .strict();

export type DeliveryValues = z.infer<typeof deliverySchema>;

export function deliveryRules(v: DeliveryValues): Rule[] {
  const rules: Rule[] = [
    rule({
      id: "set-delivery-risk-cap",
      title: "납기 안내 자동 처리 위험 상한",
      scope: "delivery_inquiry",
      effect: { kind: "cap_risk", max: v.autoAlertMaxRisk },
      statement: `납기 안내 자동 처리는 위험등급 ${v.autoAlertMaxRisk} 이하만.`,
    }),
  ];
  if (v.requireDeliveryAddress) {
    rules.push(
      rule({
        id: "set-delivery-require-address",
        title: "배송 주소 필수",
        scope: "delivery_inquiry",
        effect: { kind: "require_field", field: "deliveryAddress" },
        statement: "배송 주소가 없으면 사람 검토.",
      }),
    );
  }
  return rules;
}

// ── 단가 (pricing) ───────────────────────────────────────────────────────────

export const pricingSchema = z
  .object({
    /** 자동 응답 허용 단가 변동률 상한 (0..1) */
    autoQuoteMaxVariation: ratio,
    /** 견적 확정은 항상 사람 (보통 true) */
    quoteFinalizeRequiresHuman: z.boolean(),
    /** 단가 변경 통보 자동 발송 금액 상한 */
    priceChangeNoticeCap: positiveInt,
  })
  .strict();

export type PricingValues = z.infer<typeof pricingSchema>;

export function pricingRules(v: PricingValues): Rule[] {
  const rules: Rule[] = [
    rule({
      id: "set-pricing-notice-cap",
      title: "단가 변경 통보 자동 발송 상한",
      scope: "quote_request",
      effect: { kind: "max_amount", amount: v.priceChangeNoticeCap },
      statement: `단가 변경 통보 자동 발송은 ${v.priceChangeNoticeCap.toLocaleString()}원 이하만.`,
    }),
  ];
  if (v.quoteFinalizeRequiresHuman) {
    rules.push(
      rule({
        id: "set-pricing-finalize-block",
        title: "견적 확정 자동 금지",
        scope: "quote_request",
        effect: { kind: "force_review", reason: "견적 확정은 사람 결정 필수" },
        priority: 95,
        statement: "견적 확정은 항상 사람이 결정.",
      }),
    );
  }
  return rules;
}

// ── 클레임 (claim) ────────────────────────────────────────────────────────────

export const claimSchema = z
  .object({
    /** 클레임 응답은 항상 사람 검토 (보통 true) */
    alwaysHumanReview: z.boolean(),
    /** 금지 표현 목록 (자동 응답 시 포함되면 차단) */
    forbiddenPhrases: z.array(z.string().min(1)).max(50),
    /** 고위험 클레임 응답 차단 */
    blockHighRisk: z.boolean(),
  })
  .strict();

export type ClaimValues = z.infer<typeof claimSchema>;

export function claimRules(v: ClaimValues): Rule[] {
  const rules: Rule[] = [];
  if (v.alwaysHumanReview) {
    rules.push(
      rule({
        id: "set-claim-human",
        title: "클레임 응답 사람 검토 필수",
        scope: "complaint",
        effect: { kind: "force_review", reason: "클레임은 사람 검토 필수" },
        priority: 95,
        statement: "클레임 응답은 항상 사람이 검토.",
      }),
    );
  }
  if (v.blockHighRisk) {
    rules.push(
      rule({
        id: "set-claim-block-high",
        title: "고위험 클레임 응답 차단",
        scope: "complaint",
        effect: { kind: "cap_risk", max: "low" },
        statement: "고위험 클레임은 자동 응답 금지.",
      }),
    );
  }
  v.forbiddenPhrases.forEach((phrase, i) =>
    rules.push(
      rule({
        id: `set-claim-forbid-${i}`,
        title: `클레임 금지 표현 #${i + 1}`,
        scope: "complaint",
        effect: { kind: "forbid_phrase", phrase },
        statement: `클레임 응답에 "${phrase}" 포함 금지.`,
      }),
    ),
  );
  return rules;
}

// ── 모듈 레지스트리 ──────────────────────────────────────────────────────────

export type ModuleName = "receivables" | "delivery" | "pricing" | "claim";

interface ModuleDef {
  module: ModuleName;
  title: string;
  schema: z.ZodType;
  toRules: (v: never) => Rule[];
}

export const MODULES: Record<ModuleName, ModuleDef> = {
  receivables: {
    module: "receivables",
    title: "미수금",
    schema: receivablesSchema,
    toRules: receivablesRules as (v: never) => Rule[],
  },
  delivery: {
    module: "delivery",
    title: "납기",
    schema: deliverySchema,
    toRules: deliveryRules as (v: never) => Rule[],
  },
  pricing: {
    module: "pricing",
    title: "단가",
    schema: pricingSchema,
    toRules: pricingRules as (v: never) => Rule[],
  },
  claim: {
    module: "claim",
    title: "클레임",
    schema: claimSchema,
    toRules: claimRules as (v: never) => Rule[],
  },
};

export const DEFAULTS: Record<ModuleName, unknown> = {
  receivables: {
    p1ThresholdDays: 30,
    autoReminderAmountCap: 1_000_000,
    maxReminderCount: 3,
    autoReminderEnabled: false,
  } satisfies ReceivablesValues,
  delivery: {
    alertLeadDays: 3,
    autoAlertMaxRisk: "low",
    requireDeliveryAddress: true,
  } satisfies DeliveryValues,
  pricing: {
    autoQuoteMaxVariation: 0.05,
    quoteFinalizeRequiresHuman: true,
    priceChangeNoticeCap: 500_000,
  } satisfies PricingValues,
  claim: {
    alwaysHumanReview: true,
    forbiddenPhrases: ["법적 조치", "보상 불가"],
    blockHighRisk: true,
  } satisfies ClaimValues,
};
