// selfcheck.ts — 시나리오 검증 (npx tsx src/selfcheck.ts)
import {
  AutonomyGate,
  CriteriaRegistry,
  ConsoleTransport,
  MemoryEventSink,
  DispatchQueue,
  ShadowLog,
  DEFAULT_CONFIG,
  type GateConfig,
  type GateInput,
} from "./index.js";

function baseInput(over: Partial<GateInput> = {}): GateInput {
  return {
    source: "runner_approval",
    refId: "ref-" + Math.random().toString(36).slice(2, 8),
    companyId: "co-1",
    action: "send_dunning_reminder",
    actionType: "dunning_reminder",
    riskLevel: "low",
    approvalPolicy: "approval_required",
    recipientKnown: true,
    reversible: true,
    text: "미수금 정기 리마인더 발송 안내",
    reason: "납기 후 30일 경과",
    confidence: 0.92,
    recipientKey: "acct-77",
    metadata: {},
    ...over,
  };
}

function makeGate(config: Partial<GateConfig>) {
  const registry = new CriteriaRegistry();
  registry.upsertFromCard({
    criterionId: "crit-dunning",
    criterionTitle: "정기 미수금 리마인더 자동 발송",
    autoAllowed: true,
    keywords: ["미수금", "리마인더"],
    actionType: "dunning_reminder",
  });
  const transport = new ConsoleTransport();
  const events = new MemoryEventSink();
  const cfg: GateConfig = { ...DEFAULT_CONFIG, ...config };
  const queue = new DispatchQueue(transport, events, cfg.dispatchDelayMs);
  const shadow = new ShadowLog();
  const gate = new AutonomyGate({
    config: cfg,
    registry,
    queue,
    shadow,
    buildDispatchPayload: (i) => ({ transport: "staff_channel", channel: "email", recipient: i.recipientKey!, body: i.text }),
  });
  return { gate, queue, transport, events, shadow, cfg };
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function main() {
  console.log("\n[1] AUTO 모드 — 기준 매칭 + 저위험 + 고신뢰 → 자동 전송");
  {
    const { gate, queue, transport } = makeGate({ mode: "AUTO", dispatchDelayMs: 1000 });
    const r = await gate.run(baseInput(), 0);
    check("판단=AUTO_SEND", r.decision.outcome === "AUTO_SEND", r.decision.blockedBy ?? "");
    check("실효=AUTO_SEND", r.effectiveOutcome === "AUTO_SEND");
    check("회수창 안에는 미전송", transport.sent.length === 0);
    await queue.flush(500);
    check("회수창 안 flush해도 미전송", transport.sent.length === 0);
    await queue.flush(2000);
    check("회수창 경과 후 전송됨", transport.sent.length === 1);
  }

  console.log("\n[2] 하드 블록 — owner_only / high risk / 비가역 / 미검증 수신자");
  {
    const { gate } = makeGate({ mode: "AUTO" });
    check("owner_only 차단",
      (await gate.run(baseInput({ approvalPolicy: "owner_only" }))).decision.blockedBy === "owner_only_policy");
    check("high risk 차단",
      (await gate.run(baseInput({ riskLevel: "high" }))).decision.blockedBy === "high_risk");
    check("비가역 차단",
      (await gate.run(baseInput({ reversible: false }))).decision.blockedBy === "irreversible_action");
    check("미검증 수신자 차단",
      (await gate.run(baseInput({ recipientKnown: false }))).decision.blockedBy === "unknown_recipient");
  }

  console.log("\n[3] 금지 액션 — 견적 확정은 기준 매칭과 무관하게 차단");
  {
    const { gate } = makeGate({ mode: "AUTO" });
    const r = await gate.run(baseInput({ actionType: "quote_finalize", text: "미수금 리마인더 견적 확정" }));
    check("금지 액션 차단", r.decision.blockedBy === "blocked_action_type");
  }

  console.log("\n[4] 저신뢰 / 기준 미매칭 → 사람 검토");
  {
    const { gate } = makeGate({ mode: "AUTO" });
    check("저신뢰 차단",
      (await gate.run(baseInput({ confidence: 0.4 }))).decision.blockedBy === "low_confidence");
    check("기준 미매칭 차단",
      (await gate.run(baseInput({ text: "관련없는 내용", actionType: "other" }))).decision.blockedBy === "no_matching_auto_criterion");
  }

  console.log("\n[5] SHADOW 모드 — 자동 전송 안 함, 보냈을 것만 기록");
  {
    const { gate, transport, shadow } = makeGate({ mode: "SHADOW", dispatchDelayMs: 0 });
    const input = baseInput();
    const r = await gate.run(input);
    check("판단=AUTO_SEND (기록상)", r.decision.outcome === "AUTO_SEND");
    check("실효=HUMAN_REVIEW", r.effectiveOutcome === "HUMAN_REVIEW");
    check("shadowed=true", r.shadowed === true);
    check("실제 전송 0건", transport.sent.length === 0);
    shadow.recordHumanOutcome(input.refId, "approved");
    const rep = shadow.report();
    check("shadow 보고서 wouldAuto>=1", rep.wouldAuto >= 1);
  }

  console.log("\n[6] 회수(recall) — 회수창 안에서 취소하면 미전송");
  {
    const { gate, queue, transport } = makeGate({ mode: "AUTO", dispatchDelayMs: 1000 });
    const r = await gate.run(baseInput(), 0);
    const ok = queue.recall(r.dispatchId!);
    check("recall 성공", ok === true);
    await queue.flush(5000);
    check("회수 후 미전송", transport.sent.length === 0);
  }

  console.log("\n[7] 킬 스위치 — 전역 차단");
  {
    const { gate } = makeGate({ mode: "AUTO", killSwitch: true });
    check("킬스위치 차단", (await gate.run(baseInput())).decision.blockedBy === "kill_switch");
  }

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL\n`);
  if (fail > 0) process.exit(1);
}

main();
