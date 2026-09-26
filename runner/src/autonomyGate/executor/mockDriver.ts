// executor/mockDriver.ts
// 검증·데모용 화면 드라이버 + 실행기를 실제 전송 경로에 끼우는 어댑터.
// 운영에서는 MockScreenDriver를 OpenClaw/접근성 드라이버로 교체한다.

import type {
  ScreenDriver,
  ScreenObservation,
  ExecEventSink,
} from "./types.js";
import type { NotifyCommand, NotifyEngineClient, NotifySendResult } from "../notifyTransport.js";
import { ScreenExecutor } from "./screenExecutor.js";
import { specFromCommand } from "./spec.js";

/** 시나리오를 주입할 수 있는 모의 드라이버 */
export class MockScreenDriver implements ScreenDriver {
  inputCalls: string[] = [];
  sendCalls = 0;
  /** 입력 후 두 번째 관찰을 다르게 만들고 싶을 때 */
  private observeQueue: ScreenObservation[];

  constructor(
    private base: ScreenObservation,
    observeOverrides: ScreenObservation[] = [],
    private opts: { inputReturns?: boolean; sendReturns?: boolean; throwOn?: "observe" | "input" | "send" } = {},
  ) {
    this.observeQueue = [...observeOverrides];
  }

  observe(): ScreenObservation {
    if (this.opts.throwOn === "observe") throw new Error("observe failed");
    return this.observeQueue.shift() ?? this.base;
  }
  inputText(text: string): boolean {
    if (this.opts.throwOn === "input") throw new Error("input failed");
    this.inputCalls.push(text);
    return this.opts.inputReturns ?? true;
  }
  tapSend(): boolean {
    if (this.opts.throwOn === "send") throw new Error("send failed");
    this.sendCalls += 1;
    return this.opts.sendReturns ?? true;
  }
}

/** 정상(전송 성공) 관찰값 */
export function okObservation(over: Partial<ScreenObservation> = {}): ScreenObservation {
  return {
    foregroundPackage: "com.kakao.talk",
    visibleSender: "대한상사",
    visibleRecentBody: "발주 관련 문의",
    hasReplyField: true,
    hasSendButton: true,
    recognitionConfidence: 0.95,
    candidateTargets: 1,
    ...over,
  };
}

/**
 * 실행기를 NotifyEngineClient로 감싼다.
 * NotifyTransport가 이 엔진에 NotifyCommand를 넣으면, 실제로 화면 실행기가 돈다.
 * (게이트 통과 → 지연 큐 → NotifyTransport → 여기 → 화면 실행기 4단계)
 */
export class ExecutorNotifyEngine implements NotifyEngineClient {
  lastResult?: NotifySendResult;
  constructor(
    private executor: ScreenExecutor,
    private events?: ExecEventSink,
  ) {}

  async enqueueCommand(cmd: NotifyCommand): Promise<NotifySendResult> {
    const spec = specFromCommand(cmd);
    const result = await this.executor.execute(spec);
    const out: NotifySendResult = {
      channel: "kakao",
      message: cmd.reply_text,
      commandId: cmd.command_id,
      deviceId: cmd.device_id,
      status: result.delivered ? "succeeded" : result.outcome,
      executionPlan: result.steps.map((s) => s.step),
      method: "visual_executor",
      reason: result.stopCondition ?? null,
    };
    this.lastResult = out;
    this.events?.emit("executor.result", {
      commandId: cmd.command_id,
      outcome: result.outcome,
      delivered: result.delivered,
      stopCondition: result.stopCondition ?? null,
    });
    return out;
  }
}
