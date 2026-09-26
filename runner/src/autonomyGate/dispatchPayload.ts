// dispatchPayload.ts
// GateInput → DispatchPayload. AutonomyGate 생성 시 buildDispatchPayload로 주입한다.

import type { GateInput } from "./types.js";
import type { DispatchPayload } from "./dispatchQueue.js";

export function buildDispatchPayload(input: GateInput): DispatchPayload {
  const md = input.metadata ?? {};
  const transport = (md.transport as "kakao_notify" | "staff_channel") ?? "staff_channel";
  const channel = (md.channel as string) ?? "manual";
  const body = (md.draftContent as string) ?? input.text;
  const recipient = input.recipientKey ?? (md.recipient as string) ?? "";

  return {
    transport,
    channel,
    recipient,
    body,
    // kakao_notify 검증 힌트
    deviceId: md.deviceId as string | undefined,
    packageName: (md.packageName as string) ?? (channel === "kakao" ? "com.kakao.talk" : undefined),
    sourceEventId: md.sourceEventId as string | undefined,
    notificationKeyHash: md.notificationKeyHash as string | undefined,
    expectedSenderHint: (md.expectedSenderHint as string) ?? recipient,
    expectedBodyHint: md.expectedBodyHint as string | undefined,
    // staff_channel 보조
    staffName: md.staffName as string | undefined,
    staffContact: md.staffContact as string | undefined,
  };
}
