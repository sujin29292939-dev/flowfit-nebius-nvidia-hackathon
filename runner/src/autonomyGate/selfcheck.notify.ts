// selfcheck.notify.ts — notify/drafter 연결 검증 (npx tsx src/selfcheck.notify.ts)
import { buildGate, gateBeforeApproval } from "./worker.js";
import {
  fromUnderstanding,
  fromApprovalDraft,
  type TaskUnderstandingResult,
  type ApprovalDraftPayload,
} from "./draftAdapters.js";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

function understanding(over: Partial<TaskUnderstandingResult> = {}): TaskUnderstandingResult {
  return {
    taskType: "reply_draft",
    title: "납기 D-3 안내 답장",
    summary: "거래처에 납기 임박 안내",
    fields: { customerName: "대한상사", requestedReplyChannel: "kakao" },
    missingFields: [],
    confidence: 0.93,
    riskLevel: "low",
    recommendedAction: "납기 D-3 안내 메시지를 카톡으로 답장",
    evidence: ["주문 #1023 납기 3일 전"],
    needsHumanReview: false,
    engine: "llm",
    ...over,
  };
}

function approvalDraft(over: Partial<ApprovalDraftPayload> = {}): ApprovalDraftPayload {
  return {
    taskId: "task-1",
    title: "미수금 리마인더",
    source: "dunning_reminder",
    riskLevel: "low",
    aiReason: "납기 후 30일 경과 미수금",
    draftContent: "안녕하세요, 미수금 리마인더 안내드립니다.",
    channel: "이메일",
    actions: ["approve_send", "edit", "reject"],
    ...over,
  };
}

const adapterOpts = {
  companyId: "co-1",
  refId: "ref-1",
  isKnownAccount: (n?: string) => !!n && n.length > 0,
  metadata: { deviceId: "device-A", confidence: 0.93 },
};

async function main() {
  console.log("\n[A] kakao 자동 전송 — 이해 결과 → NotifyCommand 적재");
  {
    const b = buildGate({ mode: "AUTO", dispatchDelayMs: 1000 });
    b.registry.upsertFromCard({
      criterionId: "c-reply", criterionTitle: "납기 안내 자동 답장",
      autoAllowed: true, keywords: ["납기", "안내"], actionType: "reply_draft",
    });
    const input = fromUnderstanding(understanding(), adapterOpts);
    const r = await gateBeforeApproval(b.gate, input, 0);
    check("판단=AUTO_SEND", r.decision.outcome === "AUTO_SEND", r.decision.blockedBy ?? "");
    check("회수창 안 미전송", b.engine.commands.length === 0);
    await b.queue.flush(500);
    check("회수창 안 flush해도 미전송", b.engine.commands.length === 0);
    await b.queue.flush(2000);
    check("전송 후 NotifyCommand 1건", b.engine.commands.length === 1);
    const cmd = b.engine.commands[0];
    check("kakao 패키지", cmd?.package_name === "com.kakao.talk");
    check("온디바이스 사전검증 켜짐", cmd?.safety.requires_pre_send_validation === true);
    check("min_confidence=임계", cmd?.safety.min_confidence === b.config.confidenceThreshold);
    check("notify 이벤트 적재", b.events.events.some((e) => e.type === "notify.command_enqueued"));
  }

  console.log("\n[B] needsHumanReview / uncertain → 강제 검토");
  {
    const b = buildGate({ mode: "AUTO" });
    b.registry.upsertFromCard({ criterionId: "c", criterionTitle: "x", autoAllowed: true, keywords: ["납기"] });
    const r1 = await gateBeforeApproval(b.gate, fromUnderstanding(understanding({ needsHumanReview: true }), adapterOpts));
    check("needsHumanReview 차단", r1.decision.blockedBy === "ai_flagged_review");
    const r2 = await gateBeforeApproval(b.gate, fromUnderstanding(understanding({ riskLevel: "uncertain" }), adapterOpts));
    check("uncertain 차단", r2.decision.blockedBy === "ai_flagged_review");
  }

  console.log("\n[C] 승인 카드 초안 — requires_check / approve_send 미포함 → 강제 검토");
  {
    const b = buildGate({ mode: "AUTO" });
    b.registry.upsertFromCard({ criterionId: "c", criterionTitle: "x", autoAllowed: true, keywords: ["미수금"], actionType: "dunning_reminder" });
    const r1 = await gateBeforeApproval(b.gate, fromApprovalDraft(approvalDraft({ riskLevel: "requires_check" }), { ...adapterOpts, metadata: { actionType: "dunning_reminder", confidence: 0.95 } }));
    check("requires_check 차단", r1.decision.blockedBy === "ai_flagged_review");
    const r2 = await gateBeforeApproval(b.gate, fromApprovalDraft(approvalDraft({ actions: ["edit", "reject"] }), { ...adapterOpts, metadata: { actionType: "dunning_reminder", confidence: 0.95 } }));
    check("approve_send 미포함 차단", r2.decision.blockedBy === "ai_flagged_review");
  }

  console.log("\n[D] staff_channel — 이메일 초안은 StaffConfirmationRequest로 전송");
  {
    const b = buildGate({ mode: "AUTO", dispatchDelayMs: 0 });
    b.registry.upsertFromCard({ criterionId: "c", criterionTitle: "x", autoAllowed: true, keywords: ["미수금"], actionType: "dunning_reminder" });
    const input = fromApprovalDraft(approvalDraft(), { ...adapterOpts, metadata: { actionType: "dunning_reminder", confidence: 0.95, recipientKey: "대한상사", recipientKnown: true } });
    const r = await gateBeforeApproval(b.gate, input, 0);
    check("판단=AUTO_SEND", r.decision.outcome === "AUTO_SEND", r.decision.blockedBy ?? "");
    await b.queue.flush(1);
    check("StaffConfirmationRequest 1건", b.staff.requests.length === 1);
    check("채널=email", b.staff.requests[0]?.channel === "email");
  }

  console.log("\n[E] SHADOW 기본 — 자동 전송 0건");
  {
    const b = buildGate({}); // 기본 SHADOW
    b.registry.upsertFromCard({ criterionId: "c", criterionTitle: "x", autoAllowed: true, keywords: ["납기"] });
    const r = await gateBeforeApproval(b.gate, fromUnderstanding(understanding(), adapterOpts));
    check("실효=HUMAN_REVIEW", r.effectiveOutcome === "HUMAN_REVIEW");
    await b.queue.flush(999999);
    check("전송 0건", b.engine.commands.length === 0 && b.staff.requests.length === 0);
  }

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL\n`);
  if (fail > 0) process.exit(1);
}

main();
