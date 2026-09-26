// policy/index.ts
// Policy 레이어 공개 API + 오케스트레이터.
// 흐름: compile(AI 주입용) → [AI가 초안 생성] → guardrail.check → applyGuardrail → gate.run

export * from "./types.js";
export * from "./stores.js";
export * from "./compiler.js";
export * from "./guardrail.js";
export * from "./applyToGate.js";

import type { GateInput } from "../types.js";
import type { CompiledContext } from "./types.js";
import { PolicyCompiler } from "./compiler.js";
import { Guardrail } from "./guardrail.js";
import { RuleStore, SettingStore } from "./stores.js";
import { toProof, applyGuardrail } from "./applyToGate.js";

export class PolicyLayer {
  readonly compiler: PolicyCompiler;
  readonly guardrail: Guardrail;

  constructor(
    readonly rules: RuleStore,
    readonly settings: SettingStore,
  ) {
    this.compiler = new PolicyCompiler(rules, settings);
    this.guardrail = new Guardrail(rules);
  }

  /** AI 호출 직전: 주입할 컨텍스트 생성 */
  contextFor(actionType?: string): CompiledContext {
    return this.compiler.compile({ actionType });
  }

  /**
   * AI 출력 직후, 게이트 직전: 같은 룰로 검증해 GateInput을 보정.
   * 룰 위반이면 forceReview가 켜져 게이트의 자동 전송이 막힌다.
   */
  enforce(input: GateInput): GateInput {
    const proof = toProof(input);
    const result = this.guardrail.check(proof);
    return applyGuardrail(input, result);
  }
}
