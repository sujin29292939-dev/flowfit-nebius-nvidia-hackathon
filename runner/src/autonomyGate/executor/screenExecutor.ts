// executor/screenExecutor.ts
// 4단계 상태기계: validate_app → match_recent_message → input_text → tap_send.
// 각 단계는 다음으로 넘어가기 전에 검증을 통과해야 하며,
// stop_condition이 하나라도 발생하면 즉시 중단(부분 전송 없음).

import type {
  ExecutionSpec,
  ExecutionResult,
  StepResult,
  StopCondition,
  ScreenDriver,
  ScreenObservation,
  ExecStep,
  ExecEventSink,
} from "./types.js";

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** 부분 문자열 양방향 매칭 (발신자/본문 힌트 대조) */
function looselyMatches(observed: string | null, hint: string | null): boolean {
  if (!hint) return true; // 힌트 없으면 이 항목으로는 막지 않음
  const o = norm(observed);
  const h = norm(hint);
  if (!o) return false;
  return o.includes(h) || h.includes(o);
}

export class ScreenExecutor {
  constructor(
    private driver: ScreenDriver,
    private events?: ExecEventSink,
  ) {}

  private now(): string {
    return new Date().toISOString();
  }

  private stop(
    steps: StepResult[],
    step: ExecStep,
    cond: StopCondition,
    detail: string,
    startedAt: string,
  ): ExecutionResult {
    steps.push({ step, ok: false, stopCondition: cond, detail, at: this.now() });
    this.events?.emit("executor.stopped", { step, stopCondition: cond, detail });
    return {
      outcome: "stopped",
      steps,
      stoppedAt: step,
      stopCondition: cond,
      delivered: false,
      startedAt,
      finishedAt: this.now(),
    };
  }

  /** 명세에 그 stop_condition이 활성화돼 있는지 (없으면 검사 생략 가능하지만 핵심은 spec.ts에서 항상 강제) */
  private enabled(spec: ExecutionSpec, cond: StopCondition): boolean {
    return spec.stopConditions.includes(cond);
  }

  async execute(spec: ExecutionSpec): Promise<ExecutionResult> {
    const startedAt = this.now();
    const steps: StepResult[] = [];
    this.events?.emit("executor.started", { commandId: spec.commandId, deviceId: spec.deviceId });

    let obs: ScreenObservation;
    try {
      obs = await this.driver.observe();
    } catch (e) {
      return this.stop(steps, "validate_app", "driver_error", String(e), startedAt);
    }

    // ── 1) validate_app — 기대 앱이 전경인가 ──────────────────────────────
    if (spec.safety.requireExpectedApp && obs.foregroundPackage !== spec.packageName) {
      return this.stop(
        steps,
        "validate_app",
        "unexpected_app",
        `foreground=${obs.foregroundPackage}, expected=${spec.packageName}`,
        startedAt,
      );
    }
    if (this.enabled(spec, "confidence_below_min") && obs.recognitionConfidence < spec.safety.minConfidence) {
      return this.stop(
        steps,
        "validate_app",
        "confidence_below_min",
        `conf=${obs.recognitionConfidence} < min=${spec.safety.minConfidence}`,
        startedAt,
      );
    }
    if (this.enabled(spec, "ambiguous_target") && obs.candidateTargets !== 1) {
      return this.stop(
        steps,
        "validate_app",
        "ambiguous_target",
        `candidateTargets=${obs.candidateTargets}`,
        startedAt,
      );
    }
    steps.push({ step: "validate_app", ok: true, detail: `app=${obs.foregroundPackage}`, confidence: obs.recognitionConfidence, at: this.now() });

    // ── 2) match_recent_message — 기대 발신자/본문과 일치 ──────────────────
    if (spec.safety.requireRecentMessageMatch) {
      const senderOk = looselyMatches(obs.visibleSender, spec.expectedSenderHint);
      const bodyOk = looselyMatches(obs.visibleRecentBody, spec.expectedBodyHint);
      if (!senderOk || !bodyOk) {
        return this.stop(
          steps,
          "match_recent_message",
          "no_recent_message_match",
          `sender=${obs.visibleSender}(${senderOk}), body=${obs.visibleRecentBody}(${bodyOk})`,
          startedAt,
        );
      }
    }
    steps.push({ step: "match_recent_message", ok: true, detail: "recent message matched", at: this.now() });

    // ── 3) input_text — 입력 필드 확인 후 입력 ────────────────────────────
    if (!obs.hasReplyField) {
      return this.stop(steps, "input_text", "reply_field_not_found", "no reply field", startedAt);
    }
    let inputOk: boolean;
    try {
      inputOk = await this.driver.inputText(spec.replyText);
    } catch (e) {
      return this.stop(steps, "input_text", "driver_error", String(e), startedAt);
    }
    if (!inputOk) {
      return this.stop(steps, "input_text", "reply_field_not_found", "inputText returned false", startedAt);
    }
    // 입력 후 화면이 예기치 않게 바뀌지 않았는지 재관찰
    let obs2: ScreenObservation;
    try {
      obs2 = await this.driver.observe();
    } catch (e) {
      return this.stop(steps, "input_text", "driver_error", String(e), startedAt);
    }
    if (this.enabled(spec, "screen_changed_midway") && obs2.foregroundPackage !== spec.packageName) {
      return this.stop(steps, "input_text", "screen_changed_midway", `app now ${obs2.foregroundPackage}`, startedAt);
    }
    if (!obs2.hasSendButton) {
      return this.stop(steps, "input_text", "send_button_not_found", "no send button after input", startedAt);
    }
    steps.push({ step: "input_text", ok: true, detail: "text entered", at: this.now() });

    // ── 4) tap_send — 실제 전송 ──────────────────────────────────────────
    let sendOk: boolean;
    try {
      sendOk = await this.driver.tapSend();
    } catch (e) {
      return this.stop(steps, "tap_send", "driver_error", String(e), startedAt);
    }
    if (!sendOk) {
      return this.stop(steps, "tap_send", "send_button_not_found", "tapSend returned false", startedAt);
    }
    steps.push({ step: "tap_send", ok: true, detail: "sent", at: this.now() });
    this.events?.emit("executor.delivered", { commandId: spec.commandId });

    return {
      outcome: "succeeded",
      steps,
      delivered: true,
      startedAt,
      finishedAt: this.now(),
    };
  }
}
