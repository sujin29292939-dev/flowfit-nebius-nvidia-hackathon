// selfcheck.policy.ts — Policy Compiler + Guardrail 검증 (npx tsx src/selfcheck.policy.ts)
import {
  PolicyLayer,
  RuleStore,
  SettingStore,
  type Rule,
} from "./policy/index.js";
import { buildGate, gateBeforeApproval } from "./worker.js";
import { fromUnderstanding, type TaskUnderstandingResult } from "./draftAdapters.js";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

function rule(over: Partial<Rule>): Rule {
  return {
    id: "r-" + Math.random().toString(36).slice(2, 7),
    title: "rule",
    scope: "*",
    effect: { kind: "force_review", reason: "default" },
    priority: 0,
    status: "active",
    statement: "정책 문장",
    updatedBy: "admin",
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function understanding(over: Partial<TaskUnderstandingResult> = {}): TaskUnderstandingResult {
  return {
    taskType: "payment_report",
    title: "미수금 리마인더",
    summary: "납기 후 30일 경과 안내",
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

function makeLayer(rules: Rule[]) {
  const rs = new RuleStore();
  const ss = new SettingStore();
  rules.forEach((r) => rs.upsert(r));
  ss.upsert({
    module: "receivables", title: "미수금",
    values: { p1ThresholdDays: 30, autoReminderAmountCap: 1000000 },
    updatedBy: "admin", updatedAt: new Date().toISOString(),
  });
  return new PolicyLayer(rs, ss);
}

const adapterOpts = {
  companyId: "co-1", refId: "ref-1",
  isKnownAccount: (n?: string) => !!n,
  metadata: { confidence: 0.95 },
};

async function main() {
  console.log("\n[1] compile — 룰·설정이 주입 컨텍스트로 컴파일됨");
  {
    const layer = makeLayer([
      rule({ scope: "payment_report", statement: "미수금 안내는 정중하게", effect: { kind: "forbid_phrase", phrase: "법적 조치" } }),
    ]);
    const ctx = layer.contextFor("payment_report");
    check("프롬프트에 정책 문장 포함", ctx.systemPromptFragment.includes("정중하게"));
    check("프롬프트에 설정값 포함", ctx.systemPromptFragment.includes("p1ThresholdDays=30"));
    check("금지문구 제약 추출", ctx.constraints.forbiddenPhrases.includes("법적 조치"));
    check("provenance 해시 존재", ctx.provenance.hash.length === 16);
  }

  console.log("\n[2] 동일 입력 → 동일 해시 (단일 진실원)");
  {
    const layer = makeLayer([rule({ scope: "payment_report", effect: { kind: "cap_risk", max: "low" } })]);
    const h1 = layer.contextFor("payment_report").provenance.hash;
    const h2 = layer.contextFor("payment_report").provenance.hash;
    check("재컴파일 해시 일치", h1 === h2);
  }

  console.log("\n[3] Guardrail — 금지 문구 위반 시 forceReview");
  {
    const layer = makeLayer([
      rule({ scope: "payment_report", effect: { kind: "forbid_phrase", phrase: "법적 조치" } }),
    ]);
    const input = fromUnderstanding(
      understanding({ recommendedAction: "미납 시 법적 조치 예정", summary: "법적 조치 안내" }),
      adapterOpts,
    );
    const enforced = layer.enforce(input);
    check("forceReview 켜짐", enforced.forceReview === true);
    const g = (enforced.metadata as any).guardrail;
    check("위반 기록됨", g.violations.length >= 1);
  }

  console.log("\n[4] Guardrail — 필수 필드 누락 시 forceReview");
  {
    const layer = makeLayer([
      rule({ scope: "payment_report", effect: { kind: "require_field", field: "orderNumber" } }),
    ]);
    const input = fromUnderstanding(understanding(), adapterOpts); // orderNumber 없음
    const enforced = layer.enforce(input);
    check("필드 누락 → forceReview", enforced.forceReview === true);
  }

  console.log("\n[5] Guardrail — 금액 상한 초과 시 forceReview");
  {
    const layer = makeLayer([
      rule({ scope: "payment_report", effect: { kind: "max_amount", amount: 100000 } }),
    ]);
    const input = fromUnderstanding(understanding({ fields: { customerName: "대한상사", amount: 500000 } }), adapterOpts);
    const enforced = layer.enforce(input);
    check("금액 초과 → forceReview", enforced.forceReview === true);
  }

  console.log("\n[6] 통합 — 룰 위반 초안은 AUTO 모드에서도 게이트가 자동 전송 안 함");
  {
    const layer = makeLayer([
      rule({ scope: "payment_report", effect: { kind: "forbid_phrase", phrase: "법적 조치" } }),
    ]);
    const b = buildGate({ mode: "AUTO" });
    b.registry.upsertFromCard({
      criterionId: "c", criterionTitle: "미수금 자동", autoAllowed: true,
      keywords: ["미수금", "리마인더"], actionType: "payment_report",
    });
    const raw = fromUnderstanding(
      understanding({ summary: "미수금 리마인더, 미납 시 법적 조치" }),
      adapterOpts,
    );
    const enforced = layer.enforce(raw);
    const r = await gateBeforeApproval(b.gate, enforced, 0);
    check("게이트가 차단(ai_flagged_review)", r.decision.blockedBy === "ai_flagged_review", r.decision.blockedBy ?? "");
    check("실효=HUMAN_REVIEW", r.effectiveOutcome === "HUMAN_REVIEW");
  }

  console.log("\n[7] 통합 — 위반 없는 초안은 정상 통과");
  {
    const layer = makeLayer([
      rule({ scope: "payment_report", effect: { kind: "forbid_phrase", phrase: "법적 조치" } }),
    ]);
    const b = buildGate({ mode: "AUTO", dispatchDelayMs: 0 });
    b.registry.upsertFromCard({
      criterionId: "c", criterionTitle: "미수금 자동", autoAllowed: true,
      keywords: ["미수금", "리마인더"], actionType: "payment_report",
    });
    const raw = fromUnderstanding(
      understanding({ summary: "미수금 리마인더 정중 안내", recommendedAction: "미수금 리마인더 발송" }),
      { ...adapterOpts, reversibleActionTypes: new Set(["payment_report"]), metadata: { confidence: 0.95, recipientKnown: true } },
    );
    const enforced = layer.enforce(raw);
    check("위반 없음", (enforced.metadata as any).guardrail.passed === true);
    const r = await gateBeforeApproval(b.gate, enforced, 0);
    check("게이트 통과 AUTO_SEND", r.decision.outcome === "AUTO_SEND", r.decision.blockedBy ?? "");
  }

  console.log("\n[8] block 효과 — 처리 자체 금지");
  {
    const layer = makeLayer([
      rule({ scope: "payment_report", effect: { kind: "block", reason: "수기 처리 전용 거래처" } }),
    ]);
    const enforced = layer.enforce(fromUnderstanding(understanding(), adapterOpts));
    check("blocked → forceReview", enforced.forceReview === true);
    check("guardrail.blocked=true", (enforced.metadata as any).guardrail.blocked === true);
  }

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL\n`);
  if (fail > 0) process.exit(1);
}

main();
