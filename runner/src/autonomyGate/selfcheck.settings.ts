// selfcheck.settings.ts — 운영 설정 스키마 검증 (npx tsx src/selfcheck.settings.ts)
import { SettingsService, DEFAULTS } from "./settings/index.js";
import { RuleStore, SettingStore, PolicyLayer } from "./policy/index.js";
import { buildGate, gateBeforeApproval } from "./worker.js";
import { fromUnderstanding, type TaskUnderstandingResult } from "./draftAdapters.js";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

function understanding(over: Partial<TaskUnderstandingResult> = {}): TaskUnderstandingResult {
  return {
    taskType: "payment_report",
    title: "미수금 리마인더",
    summary: "미수금 리마인더 정중 안내",
    fields: { customerName: "대한상사", amount: 500000, requestedReplyChannel: "email" },
    missingFields: [],
    confidence: 0.95,
    riskLevel: "low",
    recommendedAction: "미수금 리마인더 발송",
    evidence: ["주문 #1023"],
    needsHumanReview: false,
    engine: "llm",
    ...over,
  };
}

function make() {
  const rs = new RuleStore();
  const ss = new SettingStore();
  const svc = new SettingsService(ss, rs);
  const layer = new PolicyLayer(rs, ss);
  return { rs, ss, svc, layer };
}

async function main() {
  console.log("\n[1] 유효 설정 — 검증 통과 + 룰 파생");
  {
    const { svc, rs } = make();
    const r = svc.apply("receivables", DEFAULTS.receivables, "owner");
    check("검증 통과", r.ok === true);
    check("룰 파생됨", r.ok && r.rules.length >= 1);
    check("금액상한 룰 active", rs.activeFor("payment_report").some((x) => x.effect.kind === "max_amount"));
  }

  console.log("\n[2] 잘못된 설정 — 거부, 정책에 들어가지 않음");
  {
    const { svc, rs, ss } = make();
    const bad = { p1ThresholdDays: -5, autoReminderAmountCap: 0, maxReminderCount: 3, autoReminderEnabled: true };
    const r = svc.apply("receivables", bad, "owner");
    check("검증 실패", r.ok === false);
    check("이슈 보고됨", !r.ok && r.issues.length >= 1);
    check("설정 저장 안 됨", ss.get("receivables") === undefined);
    check("룰 추가 안 됨", rs.list().length === 0);
  }

  console.log("\n[3] strict — 정의되지 않은 키 거부");
  {
    const { svc } = make();
    const r = svc.apply("receivables", { ...DEFAULTS.receivables as object, unknownKey: 1 }, "owner");
    check("미정의 키 거부", r.ok === false);
  }

  console.log("\n[4] 재적용 — 이전 룰 비활성, 새 룰로 교체");
  {
    const { svc, rs } = make();
    svc.apply("receivables", { ...(DEFAULTS.receivables as object), autoReminderEnabled: false }, "owner");
    const disabledRulePresent = rs.activeFor("payment_report").some((x) => x.id === "set-receivables-disabled");
    check("비활성 시 force_review 룰 active", disabledRulePresent);
    // 다시 활성으로 변경
    svc.apply("receivables", { ...(DEFAULTS.receivables as object), autoReminderEnabled: true }, "owner");
    const stillDisabled = rs.activeFor("payment_report").some((x) => x.id === "set-receivables-disabled");
    check("재적용 후 이전 룰 사라짐", stillDisabled === false);
  }

  console.log("\n[5] patch — 부분 변경도 전체 재검증");
  {
    const { svc, ss } = make();
    svc.apply("receivables", DEFAULTS.receivables, "owner");
    const r = svc.applyPatch("receivables", { autoReminderAmountCap: 2_000_000 }, "owner");
    check("patch 적용 성공", r.ok === true);
    check("값 반영됨", ss.value("receivables", "autoReminderAmountCap") === 2_000_000);
    const bad = svc.applyPatch("receivables", { p1ThresholdDays: -1 }, "owner");
    check("잘못된 patch 거부", bad.ok === false);
  }

  console.log("\n[6] 클레임 — 금지 표현이 Guardrail 룰로 연결");
  {
    const { svc, layer } = make();
    svc.apply("claim", DEFAULTS.claim, "owner");
    const input = layer.enforce(
      fromUnderstanding(
        understanding({ taskType: "complaint", summary: "클레임 응답: 보상 불가 안내" }),
        { companyId: "co-1", refId: "r1", isKnownAccount: () => true, metadata: { confidence: 0.95 } },
      ),
    );
    check("금지 표현 → forceReview", input.forceReview === true);
  }

  console.log("\n[7] 통합 — 설정이 게이트 자동 전송을 실제 제어");
  {
    const { svc, layer } = make();
    const b = buildGate({ mode: "AUTO", dispatchDelayMs: 0 });
    b.registry.upsertFromCard({
      criterionId: "c", criterionTitle: "미수금 자동", autoAllowed: true,
      keywords: ["미수금"], actionType: "payment_report",
    });
    const opts = {
      companyId: "co-1", refId: "r1",
      isKnownAccount: (n?: string) => !!n,
      reversibleActionTypes: new Set(["payment_report"]),
      metadata: { confidence: 0.95, recipientKnown: true, amount: 500000 },
    };

    // 설정: 금액 상한 100,000 → 500,000 초안은 막혀야 함
    svc.apply("receivables", { p1ThresholdDays: 30, autoReminderAmountCap: 100_000, maxReminderCount: 3, autoReminderEnabled: true }, "owner");
    const blocked = await gateBeforeApproval(b.gate, layer.enforce(fromUnderstanding(understanding(), opts)), 0);
    check("상한 초과 → 차단", blocked.effectiveOutcome === "HUMAN_REVIEW", blocked.decision.blockedBy ?? "");

    // 설정: 상한 1,000,000 → 같은 초안 통과
    svc.apply("receivables", { p1ThresholdDays: 30, autoReminderAmountCap: 1_000_000, maxReminderCount: 3, autoReminderEnabled: true }, "owner");
    const okPass = await gateBeforeApproval(b.gate, layer.enforce(fromUnderstanding(understanding(), opts)), 0);
    check("상한 상향 → 자동 전송", okPass.decision.outcome === "AUTO_SEND", okPass.decision.blockedBy ?? "");
  }

  console.log("\n[8] applyDefaults — 4개 모듈 일괄 초기화");
  {
    const { svc, ss } = make();
    svc.applyDefaults("system");
    check("4개 모듈 저장됨", ss.list().length === 4);
  }

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL\n`);
  if (fail > 0) process.exit(1);
}

main();
