// notifyTransport.ts
// 추상 Transport를 실제 전송 타입으로 채운 구현체.
//   - kakao_notify  → NotifyCommand (모바일 알림 답장 / 비주얼 실행기, 온디바이스 2차 검증 포함)
//   - staff_channel → StaffConfirmationRequest (sms/email/slack/...)
// 구체 타입이 없는 채널은 조용히 버리지 않고 명시적으로 실패시킨다(fail-safe).

import type { GateConfig } from "./types.js";
import type { DispatchJob, Transport, EventSink } from "./dispatchQueue.js";

// ── 실제 코드의 전송 타입 미러 ────────────────────────────────────────────────

export interface NotifyCommand {
  command_id: string;
  type: "send_notification_reply";
  device_id: string;
  source_event_id: string | null;
  package_name: string | null;
  notification_key_hash: string | null;
  notification_tap_region: unknown | null;
  expected_sender_hint: string | null;
  expected_body_hint: string | null;
  reply_text: string;
  execution_plan: string[];
  remote_input: { enabled: boolean; require_notification_action: boolean };
  visual_executor: {
    enabled: boolean;
    requires_screen_validation: boolean;
    allowed_actions: string[];
    stop_conditions: string[];
  };
  safety: {
    requires_pre_send_validation: boolean;
    min_confidence: number;
    require_expected_app: boolean;
    require_recent_message_match: boolean;
  };
  status: "queued" | "delivered" | "succeeded" | "failed" | "expired";
  attempts: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  delivered_at: string | null;
  completed_at: string | null;
  result: unknown | null;
}

export interface NotifySendResult {
  channel: "kakao";
  message: string;
  commandId: string;
  deviceId: string;
  status: string;
  executionPlan: string[];
  method: string | null;
  reason: string | null;
}

export type StaffRequestChannel =
  | "sms" | "email" | "gmail" | "outlook"
  | "slack" | "teams"
  | "kakao_work" | "kakaowork"
  | "telegram"
  | "webhook" | "jandi"
  | "manual";

export interface StaffConfirmationRequestDraft {
  companyId: string;
  channel: StaffRequestChannel;
  staffName: string;
  staffContact?: string;
  credentialRef?: string;
  title: string;
  question: string;
  responseOptions: string[];
  messagePreview: string;
  internalReason: string;
  metadata?: Record<string, unknown>;
}

// ── 외부 연결 지점 (운영에서 구현 주입) ───────────────────────────────────────

/** kakao: flowfit-local-engine에 NotifyCommand를 적재 */
export interface NotifyEngineClient {
  enqueueCommand(cmd: NotifyCommand): Promise<NotifySendResult> | NotifySendResult;
}

/** staff_channel: StaffConfirmationRequest 발송 */
export interface StaffChannelSender {
  send(req: StaffConfirmationRequestDraft): Promise<{ status: string; error?: string; channel?: string; messageId?: string }> | { status: string; error?: string; channel?: string; messageId?: string };
}

// ── 기본(메모리) 구현 — 검증·데모용 ──────────────────────────────────────────

export class MemoryNotifyEngine implements NotifyEngineClient {
  commands: NotifyCommand[] = [];
  enqueueCommand(cmd: NotifyCommand): NotifySendResult {
    this.commands.push(cmd);
    return {
      channel: "kakao",
      message: cmd.reply_text,
      commandId: cmd.command_id,
      deviceId: cmd.device_id,
      status: cmd.status, // "queued"
      executionPlan: cmd.execution_plan,
      method: "remote_input",
      reason: null,
    };
  }
}

export class MemoryStaffSender implements StaffChannelSender {
  requests: StaffConfirmationRequestDraft[] = [];
  send(req: StaffConfirmationRequestDraft): { status: string } {
    this.requests.push(req);
    return { status: "sent" };
  }
}

// ── 빌더 ──────────────────────────────────────────────────────────────────

let cmdSeq = 0;

export function buildNotifyCommand(job: DispatchJob, config: GateConfig, ttlMs = 600_000): NotifyCommand {
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();
  const p = job.payload;
  cmdSeq += 1;
  return {
    command_id: `cmd-${now}-${cmdSeq}`,
    type: "send_notification_reply",
    device_id: (p.deviceId as string) ?? "unknown-device",
    source_event_id: (p.sourceEventId as string) ?? null,
    package_name: (p.packageName as string) ?? "com.kakao.talk",
    notification_key_hash: (p.notificationKeyHash as string) ?? null,
    notification_tap_region: null,
    expected_sender_hint: (p.expectedSenderHint as string) ?? p.recipient ?? null,
    expected_body_hint: (p.expectedBodyHint as string) ?? null,
    reply_text: p.body,
    execution_plan: [
      "validate_expected_app",
      "match_recent_message",
      "remote_input_reply",
      "fallback_visual_send",
    ],
    remote_input: { enabled: true, require_notification_action: true },
    visual_executor: {
      enabled: true,
      requires_screen_validation: true,
      allowed_actions: ["focus_reply_field", "type_text", "tap_send"],
      stop_conditions: [
        "unexpected_app",
        "no_recent_message_match",
        "confidence_below_min",
        "ambiguous_target",
        "reply_field_not_found",
        "send_button_not_found",
        "screen_changed_midway",
      ],
    },
    // 게이트와 별개의 온디바이스 2차 검증 — 보수적으로 전부 켠다
    safety: {
      requires_pre_send_validation: true,
      min_confidence: config.confidenceThreshold,
      require_expected_app: true,
      require_recent_message_match: true,
    },
    status: "queued",
    attempts: 0,
    created_at: iso(now),
    updated_at: iso(now),
    expires_at: iso(now + ttlMs),
    delivered_at: null,
    completed_at: null,
    result: null,
  };
}

export function buildStaffRequest(job: DispatchJob): StaffConfirmationRequestDraft {
  const p = job.payload;
  const metadata: Record<string, unknown> = {
    ...p,
    refId: job.refId,
    actionType: job.actionType,
  };
  return {
    companyId: job.companyId,
    channel: (p.channel as StaffRequestChannel) ?? "manual",
    staffName: (p.staffName as string) ?? p.recipient,
    staffContact: (p.staffContact as string | undefined) ?? p.recipient,
    credentialRef: p.credentialRef as string | undefined,
    title: `자동 발송: ${job.actionType}`,
    question: p.body,
    responseOptions: (p.responseOptions as string[]) ?? ["확인", "보류"],
    messagePreview: p.body,
    internalReason: `autonomy-gate dispatch (${job.refId})`,
    metadata,
  };
}

// ── Transport ───────────────────────────────────────────────────────────────

export class NotifyTransport implements Transport {
  results: NotifySendResult[] = [];

  constructor(
    private config: GateConfig,
    private engine: NotifyEngineClient,
    private staff: StaffChannelSender,
    private events?: EventSink,
  ) {}

  async send(job: DispatchJob): Promise<void> {
    const transport = job.payload.transport;
    if (transport === "kakao_notify") {
      const cmd = buildNotifyCommand(job, this.config);
      const result = await this.engine.enqueueCommand(cmd);
      this.results.push(result);
      this.events?.emit("notify.command_enqueued", {
        commandId: cmd.command_id,
        refId: job.refId,
        deviceId: cmd.device_id,
        status: result.status,
      });
      return;
    }
    if (transport === "staff_channel") {
      const req = buildStaffRequest(job);
      const r = await this.staff.send(req);
      if (r.status !== "sent" && r.status !== "queued" && r.status !== "ok") {
        this.events?.emit("staff.request_failed", {
          refId: job.refId,
          channel: req.channel,
          status: r.status,
          error: r.error,
        });
        throw new Error(r.error ?? `staff_send_failed:${r.status}`);
      }
      this.events?.emit("staff.request_sent", {
        refId: job.refId,
        channel: r.channel ?? req.channel,
        status: r.status,
        messageId: r.messageId,
      });
      return;
    }
    // 구체 전송체가 없으면 명시적 실패 (조용히 버리지 않음)
    throw new Error(`no_transport_for_channel:${job.payload.channel}`);
  }
}
