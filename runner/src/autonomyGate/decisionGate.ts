import type { AutonomyDecision } from "../connectors/workExecutionPipeline.js";
import { isWriteCapability, type Capability } from "../connectors/connectorTypes.js";
import { applyOfflineDemotion, type RuleRef, type Tier } from "../connectors/offlinePolicy.js";
import type { GateResult, RiskLevel } from "./types.js";

export type GateContext = {
  capability: Capability | string;
  riskLevel: RiskLevel;
  ruleEffect?: string;
  ruleText?: string;
  rule?: RuleRef;
  deviceMode?: "ONLINE" | "OFFLINE" | "RECOVERING";
  gate?: Pick<GateResult, "decision" | "mode" | "effectiveOutcome"> | null;
};

export type UnifiedGateDecision = {
  decision: AutonomyDecision;
  reason: string;
  gateMode?: GateResult["mode"];
  gateEffectiveOutcome?: GateResult["effectiveOutcome"];
  blockedBy?: string;
  writeCapability: boolean;
};

export function evaluateTaskAutonomy(input: GateContext): UnifiedGateDecision {
  const writeCapability = isWriteCapability(input.capability as Capability);
  const blockedBy = input.gate?.decision.blockedBy;
  const gateMode = input.gate?.mode;
  const gateEffectiveOutcome = input.gate?.effectiveOutcome;

  if (blockedBy === "kill_switch") {
    return {
      decision: "BLOCK",
      reason: "자동 실행 중지 스위치가 켜져 있어 실행을 중단했습니다.",
      gateMode,
      gateEffectiveOutcome,
      blockedBy,
      writeCapability,
    };
  }

  if (
    input.ruleEffect === "require_review_when_same_context" ||
    input.ruleEffect === "approval_required_when_same_context"
  ) {
    return {
      decision: "ASSIST",
      reason: input.ruleText ?? "이전 승인 결과에 따라 검토가 필요합니다.",
      gateMode,
      gateEffectiveOutcome,
      blockedBy,
      writeCapability,
    };
  }

  if (input.ruleEffect === "auto_allowed_when_same_context" && input.riskLevel === "low" && !blockedBy) {
    return withOfflinePolicy({
      policyTier: "AUTO",
      reason: input.ruleText ?? "이전 승인 규칙과 동일한 낮은 위험 작업입니다.",
      input,
      writeCapability,
      gateMode,
      gateEffectiveOutcome,
      blockedBy,
    });
  }

  if (writeCapability) {
    return {
      decision: "SHADOW",
      reason: `${input.capability} 쓰기 능력은 첫 실행을 SHADOW 모드로 검증합니다.`,
      gateMode,
      gateEffectiveOutcome,
      blockedBy,
      writeCapability,
    };
  }

  if (blockedBy && blockedBy !== "no_matching_auto_criterion") {
    return {
      decision: "ASSIST",
      reason: blockedBy,
      gateMode,
      gateEffectiveOutcome,
      blockedBy,
      writeCapability,
    };
  }

  return withOfflinePolicy({
    policyTier: "AUTO",
    reason: blockedBy ?? input.gate?.decision.matchedCriterionId ?? "승인 검토가 필요하지 않은 낮은 위험 작업입니다.",
    input,
    writeCapability,
    gateMode,
    gateEffectiveOutcome,
    blockedBy,
  });
}

function withOfflinePolicy(args: {
  policyTier: Tier;
  reason: string;
  input: GateContext;
  writeCapability: boolean;
  gateMode?: GateResult["mode"];
  gateEffectiveOutcome?: GateResult["effectiveOutcome"];
  blockedBy?: string;
}): UnifiedGateDecision {
  const demoted = applyOfflineDemotion({
    policyTier: args.policyTier,
    capability: args.writeCapability ? "write" : "read",
    deviceMode: args.input.deviceMode ?? "OFFLINE",
    rule: args.input.rule ?? {
      id: "no-rule",
      serverSafeFlag: false,
      connectorPath: true,
      idempotentWrite: false,
      approvalCount: 0,
    },
  });
  if (demoted !== args.policyTier) {
    return {
      decision: demoted as AutonomyDecision,
      reason: `실행 PC 상태가 ${args.input.deviceMode ?? "OFFLINE"}이어서 ${args.policyTier}에서 ${demoted}로 전환했습니다. ${args.reason}`,
      gateMode: args.gateMode,
      gateEffectiveOutcome: args.gateEffectiveOutcome,
      blockedBy: args.blockedBy,
      writeCapability: args.writeCapability,
    };
  }
  return {
    decision: args.policyTier as AutonomyDecision,
    reason: args.reason,
    gateMode: args.gateMode,
    gateEffectiveOutcome: args.gateEffectiveOutcome,
    blockedBy: args.blockedBy,
    writeCapability: args.writeCapability,
  };
}
