// policy/compiler.ts
// 룰 + 설정 → AI 주입 컨텍스트.
// 같은 컴파일 결과를 Guardrail이 재사용하므로, "AI가 받은 룰"과
// "출력을 검증하는 룰"이 반드시 일치한다(단일 진실원).

import type { RiskLevel } from "../types.js";
import type { Rule, ModuleSetting, CompiledContext } from "./types.js";
import type { RuleStore, SettingStore } from "./stores.js";
import { createHash } from "node:crypto";

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high"];

function minRisk(a: RiskLevel | null, b: RiskLevel): RiskLevel {
  if (a === null) return b;
  return RISK_ORDER.indexOf(a) <= RISK_ORDER.indexOf(b) ? a : b;
}

function stableHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16);
}

export interface CompileInput {
  /** 특정 액션 유형으로 좁혀 컴파일. 미지정이면 전체 active 룰 */
  actionType?: string;
}

export class PolicyCompiler {
  constructor(
    private rules: RuleStore,
    private settings: SettingStore,
  ) {}

  compile(input: CompileInput = {}): CompiledContext {
    const ruleSet: Rule[] = input.actionType
      ? this.rules.activeFor(input.actionType)
      : this.rules.allActive();
    const settingList: ModuleSetting[] = this.settings.list();

    const forbiddenPhrases: string[] = [];
    const requiredFields: string[] = [];
    let maxRiskLevel: RiskLevel | null = null;
    let maxAmount: number | null = null;
    const forceReviewActions: string[] = [];
    const blockedActions: string[] = [];

    for (const r of ruleSet) {
      const e = r.effect;
      switch (e.kind) {
        case "forbid_phrase":
          forbiddenPhrases.push(e.phrase);
          break;
        case "require_field":
          requiredFields.push(e.field);
          break;
        case "cap_risk":
          maxRiskLevel = minRisk(maxRiskLevel, e.max);
          break;
        case "max_amount":
          maxAmount = maxAmount === null ? e.amount : Math.min(maxAmount, e.amount);
          break;
        case "force_review":
          if (r.scope !== "*") forceReviewActions.push(r.scope);
          break;
        case "block":
          if (r.scope !== "*") blockedActions.push(r.scope);
          break;
      }
    }

    const systemPromptFragment = this.renderPrompt(ruleSet, settingList);
    const provenance = {
      ruleIds: ruleSet.map((r) => r.id),
      settingModules: settingList.map((s) => s.module),
      compiledAt: new Date().toISOString(),
      hash: stableHash({
        rules: ruleSet.map((r) => ({ id: r.id, effect: r.effect, priority: r.priority })),
        settings: settingList.map((s) => ({ m: s.module, v: s.values })),
      }),
    };

    return {
      systemPromptFragment,
      constraints: {
        forbiddenPhrases: [...new Set(forbiddenPhrases)],
        requiredFields: [...new Set(requiredFields)],
        maxRiskLevel,
        maxAmount,
        forceReviewActions: [...new Set(forceReviewActions)],
        blockedActions: [...new Set(blockedActions)],
      },
      provenance,
    };
  }

  /** 사람이 읽는 정책 프롬프트 조각. AI 시스템 프롬프트에 강제 주입 */
  private renderPrompt(rules: Rule[], settings: ModuleSetting[]): string {
    const lines: string[] = [];
    lines.push("## 적용 정책 (반드시 준수)");
    if (rules.length === 0) {
      lines.push("- (활성 룰 없음)");
    } else {
      rules.forEach((r, i) => lines.push(`${i + 1}. [${r.scope}] ${r.statement}`));
    }
    if (settings.length > 0) {
      lines.push("");
      lines.push("## 모듈 설정값");
      for (const s of settings) {
        const kv = Object.entries(s.values)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        lines.push(`- ${s.title}(${s.module}): ${kv}`);
      }
    }
    lines.push("");
    lines.push("위 정책을 위반하는 초안은 생성하지 말 것. 판단이 모호하면 needsHumanReview=true로 둘 것.");
    return lines.join("\n");
  }
}
