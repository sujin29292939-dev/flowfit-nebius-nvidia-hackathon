// selfcheck.learning.ts — 물레방아 ⑤⑥ 검증 (npx tsx src/selfcheck.learning.ts)
import {
  RuleLearner,
  PromotionService,
  DEFAULT_LEARNER_CONFIG,
  toApprovalEvent,
  type ApprovalEvent,
  type LearnerConfig,
} from "./learning/index.js";
import { RuleStore, SettingStore, PolicyLayer } from "./policy/index.js";
import { buildGate, gateBeforeApproval } from "./worker.js";
import { fromUnderstanding, type TaskUnderstandingResult } from "./draftAdapters.js";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

function event(over: Partial<ApprovalEvent> = {}): ApprovalEvent {
  return {
    refId: "ref-" + Math.random().toString(36).slice(2, 7),
    companyId: "co-1",
    actionType: "payment_report",
    outcome: "approved",
    riskLevel: "low",
    context: { recipientKnown: true, matchedKeywords: ["미수금", "리마인더"] },
    confidence: 0.95,
    decidedAt: new Date().toISOString(),
    ...over,
  };
}

function understanding(over: Partial<TaskUnderstandingResult> = {}): TaskUnderstandingResult {
  return {
    taskType: "payment_report",
    title: "미수금 리마인더",
    summary: "미수금 리마인더 정중 안내",
    fields: { customerName: "대한상사", requestedReplyChannel: "email" },
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

const admin = { userId: "owner-1", isAdmin: true };
const nonAdmin = { userId: "staff-1", isAdmin: false };

async function main() {
  console.log("\n[1] 소표본 — 후보·승격 제안 안 함 (베이지안 보수성)");
  {
    const learner = new RuleLearner(DEFAULT_LEARNER_CONFIG);
    for (let i = 0; i < 3; i++) learner.learn(event());
    check("후보 없음(표본<5)", learner.proposeCandidates().length === 0);
    check("승격 없음(표본<20)", learner.proposePromotions().length === 0);
  }

  console.log("\n[2] 후보 제안 — 표본 충분 + 낮은 반려율");
  {
    const learner = new RuleLearner(DEFAULT_LEARNER_CONFIG);
    for (let i = 0; i < 8; i++) learner.learn(event());
    const cands = learner.proposeCandidates();
    check("후보 1건 이상", cands.length >= 1);
    check("후보는 cap_risk", cands[0]?.proposedEffect.kind === "cap_risk");
    check("근거 통계 포함", (cands[0]?.evidence.total ?? 0) >= 8);
  }

  console.log("\n[3] 높은 반려율 — 후보 제안 안 함");
  {
    const learner = new RuleLearner(DEFAULT_LEARNER_CONFIG);
    for (let i = 0; i < 6; i++) learner.learn(event());
    for (let i = 0; i < 4; i++) learner.learn(event({ outcome: "rejected" }));
    check("반려율 높으면 후보 없음", learner.proposeCandidates().length === 0);
  }

  console.log("\n[4] 후보 등록 — candidate 상태로만 들어감 (자동 활성 안 됨)");
  {
    const { CriteriaRegistry } = await import("./criteriaRegistry.js");
    const rs = new RuleStore();
    const reg = new CriteriaRegistry();
    const svc = new PromotionService(rs, reg);
    const learner = new RuleLearner(DEFAULT_LEARNER_CONFIG);
    for (let i = 0; i < 8; i++) learner.learn(event());
    const cand = learner.proposeCandidates()[0]!;
    const rule = svc.registerCandidate(cand);
    check("등록 상태=candidate", rule.status === "candidate");
    check("active 룰에는 없음", rs.activeFor("payment_report").length === 0);
  }

  console.log("\n[5] 권한 — 비-Admin 승격 거부");
  {
    const { CriteriaRegistry } = await import("./criteriaRegistry.js");
    const rs = new RuleStore();
    const svc = new PromotionService(rs, new CriteriaRegistry());
    const learner = new RuleLearner(DEFAULT_LEARNER_CONFIG);
    for (let i = 0; i < 8; i++) learner.learn(event());
    const cand = learner.proposeCandidates()[0]!;
    svc.registerCandidate(cand);
    check("비-Admin 거부", svc.promoteRule(cand.id, nonAdmin).ok === false);
    check("Admin 승격 성공", svc.promoteRule(cand.id, admin).ok === true);
    check("승격 후 active", rs.activeFor("payment_report").length === 1);
  }

  console.log("\n[6] AUTO 승격 — 누적 충분 시 제안, autoAllowed는 false");
  {
    const learner = new RuleLearner(DEFAULT_LEARNER_CONFIG);
    for (let i = 0; i < 22; i++) learner.learn(event());
    const proms = learner.proposePromotions();
    check("승격 제안 1건 이상", proms.length >= 1);
    check("제안 autoAllowed=false", proms[0]?.suggestedCriterion.autoAllowed === false);
    check("키워드 누적됨", (proms[0]?.suggestedCriterion.keywords.length ?? 0) >= 1);
  }

  console.log("\n[7] 물레방아 한 바퀴 — 학습 전 차단 → Admin 승격 → 학습 후 자동 전송");
  {
    const { CriteriaRegistry } = await import("./criteriaRegistry.js");
    const rs = new RuleStore();
    const ss = new SettingStore();
    const layer = new PolicyLayer(rs, ss);

    const b = buildGate({ mode: "AUTO", dispatchDelayMs: 0 });
    const svc = new PromotionService(rs, b.registry);
    const learner = new RuleLearner(DEFAULT_LEARNER_CONFIG);

    const opts = {
      companyId: "co-1", refId: "ref-x",
      isKnownAccount: (n?: string) => !!n,
      reversibleActionTypes: new Set(["payment_report"]),
      metadata: { confidence: 0.95, recipientKnown: true, matchedKeywords: ["미수금", "리마인더"] },
    };

    // (전) 자동 전송 기준이 없으므로 게이트는 사람 검토로 보냄
    const before = await gateBeforeApproval(
      b.gate,
      layer.enforce(fromUnderstanding(understanding(), opts)),
      0,
    );
    check("학습 전 = HUMAN_REVIEW", before.effectiveOutcome === "HUMAN_REVIEW", before.decision.blockedBy ?? "");

    // ④승인 누적 → ⑤학습
    for (let i = 0; i < 22; i++) {
      const ev = toApprovalEvent(
        layer.enforce(fromUnderstanding(understanding(), opts)),
        "approved",
      );
      learner.learn(ev);
    }
    const prom = learner.proposePromotions()[0]!;
    check("승격 제안 생성됨", !!prom);

    // ⑥Admin이 AUTO 승격 수락 → 기준 활성화
    const r = svc.acceptPromotion(prom, admin);
    check("Admin 승격 수락", r.ok === true);

    // (후) 같은 초안이 이제 자동 전송으로 승격
    const after = await gateBeforeApproval(
      b.gate,
      layer.enforce(fromUnderstanding(understanding(), opts)),
      0,
    );
    check("학습 후 = AUTO_SEND", after.decision.outcome === "AUTO_SEND", after.decision.blockedBy ?? "");
    await b.queue.flush(1);
    check("실제 전송 발생", b.staff.requests.length + b.engine.commands.length === 1);
  }

  console.log("\n[8] 안전 — AUTO 승격해도 룰 위반 초안은 여전히 차단");
  {
    const { CriteriaRegistry } = await import("./criteriaRegistry.js");
    const rs = new RuleStore();
    const ss = new SettingStore();
    // 금지 문구 룰을 active로
    rs.upsert({
      id: "r-forbid", title: "금지문구", scope: "payment_report",
      effect: { kind: "forbid_phrase", phrase: "법적 조치" },
      priority: 100, status: "active", statement: "법적 조치 표현 금지",
      updatedBy: "admin", updatedAt: new Date().toISOString(),
    });
    const layer = new PolicyLayer(rs, ss);
    const b = buildGate({ mode: "AUTO", dispatchDelayMs: 0 });
    const svc = new PromotionService(rs, b.registry);
    const learner = new RuleLearner(DEFAULT_LEARNER_CONFIG);

    const opts = {
      companyId: "co-1", refId: "ref-y",
      isKnownAccount: (n?: string) => !!n,
      reversibleActionTypes: new Set(["payment_report"]),
      metadata: { confidence: 0.95, recipientKnown: true, matchedKeywords: ["미수금"] },
    };
    for (let i = 0; i < 22; i++) learner.learn(event());
    svc.acceptPromotion(learner.proposePromotions()[0]!, admin);

    // 위반 초안: "법적 조치" 포함
    const bad = layer.enforce(
      fromUnderstanding(understanding({ summary: "미수금 리마인더, 미납 시 법적 조치" }), opts),
    );
    const r = await gateBeforeApproval(b.gate, bad, 0);
    check("위반 초안은 승격 후에도 차단", r.decision.blockedBy === "ai_flagged_review", r.decision.blockedBy ?? "");
  }

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL\n`);
  if (fail > 0) process.exit(1);
}

main();
