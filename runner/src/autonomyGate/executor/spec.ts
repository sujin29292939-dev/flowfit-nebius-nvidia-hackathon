// executor/spec.ts
// NotifyCommand → ExecutionSpec.
// NotifyCommand.safety/visual_executor 필드를 실행기 검증 입력으로 정규화한다.

import type { NotifyCommand } from "../notifyTransport.js";
import type { ExecutionSpec, StopCondition } from "./types.js";

const KNOWN_STOPS: StopCondition[] = [
  "unexpected_app",
  "no_recent_message_match",
  "confidence_below_min",
  "ambiguous_target",
  "reply_field_not_found",
  "send_button_not_found",
  "screen_changed_midway",
  "timeout",
  "driver_error",
];

function normalizeStops(raw: string[]): StopCondition[] {
  const set = new Set<StopCondition>();
  for (const s of raw) {
    if ((KNOWN_STOPS as string[]).includes(s)) set.add(s as StopCondition);
  }
  // 핵심 안전 조건은 명령에 없더라도 항상 강제로 포함
  set.add("unexpected_app");
  set.add("no_recent_message_match");
  set.add("ambiguous_target");
  set.add("confidence_below_min");
  set.add("screen_changed_midway");
  set.add("reply_field_not_found");
  set.add("send_button_not_found");
  set.add("driver_error");
  return [...set];
}

export function specFromCommand(cmd: NotifyCommand): ExecutionSpec {
  return {
    commandId: cmd.command_id,
    deviceId: cmd.device_id,
    packageName: cmd.package_name ?? "com.kakao.talk",
    expectedSenderHint: cmd.expected_sender_hint,
    expectedBodyHint: cmd.expected_body_hint,
    notificationKeyHash: cmd.notification_key_hash,
    replyText: cmd.reply_text,
    allowedActions: cmd.visual_executor.allowed_actions,
    stopConditions: normalizeStops(cmd.visual_executor.stop_conditions),
    safety: {
      requiresPreSendValidation: cmd.safety.requires_pre_send_validation,
      minConfidence: cmd.safety.min_confidence,
      requireExpectedApp: cmd.safety.require_expected_app,
      requireRecentMessageMatch: cmd.safety.require_recent_message_match,
    },
  };
}
