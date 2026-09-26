// selfcheck.executor.ts — 화면 자동화 실행기 검증 (npx tsx src/selfcheck.executor.ts)
import {
  ScreenExecutor,
  MockScreenDriver,
  ExecutorNotifyEngine,
  okObservation,
  specFromCommand,
  type ScreenObservation,
} from "./executor/index.js";
import { buildNotifyCommand } from "./notifyTransport.js";
import { MemoryEventSink } from "./dispatchQueue.js";
import { DEFAULT_CONFIG } from "./types.js";
import type { DispatchJob } from "./dispatchQueue.js";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

function job(): DispatchJob {
  return {
    id: "d-1", companyId: "co-1", refId: "ref-1", actionType: "reply_draft",
    payload: {
      transport: "kakao_notify", channel: "kakao", recipient: "대한상사",
      body: "납기 D-3 안내드립니다.", deviceId: "device-A",
      expectedSenderHint: "대한상사", expectedBodyHint: "발주 관련 문의",
    },
    enqueuedAt: 0, fireAt: 0, status: "scheduled",
  };
}

function spec() {
  return specFromCommand(buildNotifyCommand(job(), DEFAULT_CONFIG));
}

async function run(driver: MockScreenDriver) {
  const exec = new ScreenExecutor(driver);
  return exec.execute(spec());
}

async function main() {
  console.log("\n[1] 정상 — 4단계 통과 후 전송");
  {
    const d = new MockScreenDriver(okObservation(), [okObservation(), okObservation()]);
    const r = await run(d);
    check("outcome=succeeded", r.outcome === "succeeded", r.stopCondition ?? "");
    check("delivered=true", r.delivered === true);
    check("4단계 모두 ok", r.steps.filter((s) => s.ok).length === 4);
    check("입력 호출됨", d.inputCalls.length === 1);
    check("전송 탭됨", d.sendCalls === 1);
  }

  console.log("\n[2] 다른 앱 — unexpected_app, 전송 안 됨");
  {
    const d = new MockScreenDriver(okObservation({ foregroundPackage: "com.android.settings" }));
    const r = await run(d);
    check("stopped", r.outcome === "stopped");
    check("stopCondition=unexpected_app", r.stopCondition === "unexpected_app");
    check("입력·전송 0", d.inputCalls.length === 0 && d.sendCalls === 0);
  }

  console.log("\n[3] 발신자 불일치 — no_recent_message_match");
  {
    const d = new MockScreenDriver(okObservation({ visibleSender: "엉뚱상사" }));
    const r = await run(d);
    check("stopCondition=no_recent_message_match", r.stopCondition === "no_recent_message_match");
    check("전송 안 됨", d.sendCalls === 0);
  }

  console.log("\n[4] 낮은 신뢰도 — confidence_below_min");
  {
    const d = new MockScreenDriver(okObservation({ recognitionConfidence: 0.5 }));
    const r = await run(d);
    check("stopCondition=confidence_below_min", r.stopCondition === "confidence_below_min");
  }

  console.log("\n[5] 모호한 대상 — ambiguous_target");
  {
    const d = new MockScreenDriver(okObservation({ candidateTargets: 3 }));
    const r = await run(d);
    check("stopCondition=ambiguous_target", r.stopCondition === "ambiguous_target");
  }

  console.log("\n[6] 입력 필드 없음 — reply_field_not_found");
  {
    const d = new MockScreenDriver(okObservation({ hasReplyField: false }));
    const r = await run(d);
    check("stopCondition=reply_field_not_found", r.stopCondition === "reply_field_not_found");
    check("전송 안 됨", d.sendCalls === 0);
  }

  console.log("\n[7] 입력 중 화면 변경 — screen_changed_midway");
  {
    const first = okObservation();
    const afterInput: ScreenObservation = okObservation({ foregroundPackage: "com.other.app" });
    // observe 순서: ①validate_app ②input 후 재관찰
    const d = new MockScreenDriver(first, [first, afterInput]);
    const r = await run(d);
    check("stopCondition=screen_changed_midway", r.stopCondition === "screen_changed_midway", r.stopCondition ?? "");
    check("입력은 됐지만 전송 안 됨", d.inputCalls.length === 1 && d.sendCalls === 0);
  }

  console.log("\n[8] 드라이버 예외 — driver_error로 안전 중단");
  {
    const d = new MockScreenDriver(okObservation(), [], { throwOn: "observe" });
    const r = await run(d);
    check("stopCondition=driver_error", r.stopCondition === "driver_error");
    check("delivered=false", r.delivered === false);
  }

  console.log("\n[9] 전송 버튼 탭 실패 — send_button_not_found");
  {
    const d = new MockScreenDriver(okObservation(), [okObservation(), okObservation()], { sendReturns: false });
    const r = await run(d);
    check("stopCondition=send_button_not_found", r.stopCondition === "send_button_not_found");
    check("delivered=false", r.delivered === false);
  }

  console.log("\n[10] 파이프라인 — NotifyTransport → 실행기 연결");
  {
    const events = new MemoryEventSink();
    const exec = new ScreenExecutor(new MockScreenDriver(okObservation(), [okObservation(), okObservation()]), events);
    const engine = new ExecutorNotifyEngine(exec, events);
    const cmd = buildNotifyCommand(job(), DEFAULT_CONFIG);
    const result = await engine.enqueueCommand(cmd);
    check("전송 성공 상태", result.status === "succeeded", result.reason ?? "");
    check("method=visual_executor", result.method === "visual_executor");
    check("executor.delivered 이벤트", events.events.some((e) => e.type === "executor.delivered"));
  }

  console.log("\n[11] 파이프라인 중단 — 잘못된 앱이면 status=stopped, reason 기록");
  {
    const exec = new ScreenExecutor(new MockScreenDriver(okObservation({ foregroundPackage: "x" })));
    const engine = new ExecutorNotifyEngine(exec);
    const result = await engine.enqueueCommand(buildNotifyCommand(job(), DEFAULT_CONFIG));
    check("status=stopped", result.status === "stopped");
    check("reason=unexpected_app", result.reason === "unexpected_app");
  }

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL\n`);
  if (fail > 0) process.exit(1);
}

main();
