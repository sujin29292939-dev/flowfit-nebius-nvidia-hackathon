// staffChannelRouter.ts
// Gate AUTO 통과 후 staff_channel 작업을 실제 채널 전송기로 라우팅한다.
// NotifyTransport는 StaffChannelSender 인터페이스만 호출하고,
// 이 라우터가 Slack/Teams/KakaoWork/Email/Webhook 중 실제 전송기를 선택한다.

import type {
  StaffChannelSender,
  StaffConfirmationRequestDraft,
  StaffRequestChannel,
} from "./notifyTransport.js";
import type { EmailAddress, EmailMessage, EmailSendResult } from "./connect/email/mime.js";
import type { WebhookFlavor, WebhookMessage } from "./connect/webhook/builders.js";

export interface StaffChannelSendResult {
  status: "sent" | "queued" | "failed";
  channel: StaffRequestChannel;
  provider?: string;
  routeId?: string;
  messageId?: string;
  error?: string;
}

export interface SlackSendPort {
  send(input: { credentialRef: string; channel: string; text: string }): Promise<{ ok: boolean; error?: string; ts?: string }> | { ok: boolean; error?: string; ts?: string };
}

export interface TeamsSendPort {
  sendChannelMessage(
    channelKey: string,
    teamId: string,
    channelId: string,
    text: string,
    now?: number,
  ): Promise<{ ok: boolean; error?: string; messageId?: string }> | { ok: boolean; error?: string; messageId?: string };
}

export interface KakaoworkSendPort {
  sendToConversation(credentialRef: string, conversationId: string, text: string): Promise<{ ok: boolean; error?: string; messageId?: string }> | { ok: boolean; error?: string; messageId?: string };
  sendToUser(credentialRef: string, userId: string, text: string): Promise<{ ok: boolean; error?: string; messageId?: string }> | { ok: boolean; error?: string; messageId?: string };
  sendByEmail(credentialRef: string, email: string, text: string): Promise<{ ok: boolean; error?: string; messageId?: string }> | { ok: boolean; error?: string; messageId?: string };
}

export interface EmailSendPort {
  send(msg: EmailMessage, now?: number): Promise<EmailSendResult> | EmailSendResult;
}

export interface WebhookSendPort {
  send(credentialRef: string, flavor: WebhookFlavor, msg: WebhookMessage): Promise<{ ok: boolean; error?: string; status?: number }> | { ok: boolean; error?: string; status?: number };
}

export interface StaffChannelSenders {
  slack?: SlackSendPort;
  teams?: TeamsSendPort;
  kakaowork?: KakaoworkSendPort;
  gmail?: EmailSendPort;
  outlook?: EmailSendPort;
  webhook?: WebhookSendPort;
  /** sms/telegram 등 아직 직접 전송기가 없는 채널은 외부 sender로 위임 가능 */
  sms?: StaffChannelSender;
  telegram?: StaffChannelSender;
  manual?: StaffChannelSender;
}

export interface StaffChannelRoute {
  id: string;
  companyId: string;
  channel: StaffRequestChannel;
  /** 토큰/키/웹훅 URL 참조. 값 자체는 절대 라우터에 저장하지 않는다. */
  credentialRef?: string;
  /** 슬랙 채널 ID, 카카오워크 userId/email/conversationId, 이메일 주소 등 실제 목적지 */
  target?: string;
  /** 낮을수록 우선. 명시 채널이 없을 때 자동 선택 기준 */
  priority: number;
  enabled: boolean;
  meta?: Record<string, unknown>;
}

export interface StaffChannelRouteBook {
  routesFor(companyId: string): Promise<StaffChannelRoute[]> | StaffChannelRoute[];
}

export class MemoryStaffRouteBook implements StaffChannelRouteBook {
  private routes = new Map<string, StaffChannelRoute[]>();

  upsert(route: Omit<StaffChannelRoute, "priority" | "enabled"> & Partial<Pick<StaffChannelRoute, "priority" | "enabled">>): void {
    const next: StaffChannelRoute = {
      priority: 100,
      enabled: true,
      ...route,
      channel: normalizeChannel(route.channel),
    };
    const arr = this.routes.get(next.companyId) ?? [];
    const idx = arr.findIndex((r) => r.id === next.id);
    if (idx >= 0) arr[idx] = next;
    else arr.push(next);
    this.routes.set(next.companyId, arr);
  }

  routesFor(companyId: string): StaffChannelRoute[] {
    return [...(this.routes.get(companyId) ?? [])];
  }
}

export interface StaffChannelRouterOptions {
  senders: StaffChannelSenders;
  routeBook?: StaffChannelRouteBook;
  /** 요청 채널이 manual/unknown일 때 선택할 기본 우선순위 */
  defaultChannelOrder?: StaffRequestChannel[];
  now?: () => number;
}

const DEFAULT_ORDER: StaffRequestChannel[] = [
  "slack",
  "teams",
  "kakao_work",
  "email",
  "webhook",
  "sms",
  "telegram",
  "manual",
];

export class StaffChannelRouter implements StaffChannelSender {
  constructor(private opts: StaffChannelRouterOptions) {}

  async send(req: StaffConfirmationRequestDraft): Promise<StaffChannelSendResult> {
    const route = await this.selectRoute(req);
    if (!route) {
      return this.fail(req, normalizeChannel(req.channel), "no_available_staff_channel_route");
    }

    const messageText = req.messagePreview || req.question;
    const now = this.opts.now?.() ?? Date.now();

    switch (route.channel) {
      case "slack": {
        const sender = this.opts.senders.slack;
        const credentialRef = route.credentialRef ?? req.credentialRef;
        const target = route.target ?? req.staffContact;
        if (!sender) return this.fail(req, route.channel, "slack_sender_missing", route);
        if (!credentialRef) return this.fail(req, route.channel, "slack_credential_missing", route);
        if (!target) return this.fail(req, route.channel, "slack_target_missing", route);
        const r = await sender.send({ credentialRef, channel: target, text: messageText });
        return r.ok ? this.ok(route, r.ts) : this.fail(req, route.channel, r.error ?? "slack_send_failed", route);
      }
      case "teams": {
        const sender = this.opts.senders.teams;
        const channelKey = str(route.meta?.channelKey) ?? str(req.metadata?.channelKey) ?? route.id;
        const teamId = str(route.meta?.teamId) ?? str(req.metadata?.teamId);
        const channelId = route.target ?? str(route.meta?.channelId) ?? str(req.metadata?.channelId);
        if (!sender) return this.fail(req, route.channel, "teams_sender_missing", route);
        if (!teamId) return this.fail(req, route.channel, "teams_team_id_missing", route);
        if (!channelId) return this.fail(req, route.channel, "teams_channel_id_missing", route);
        const r = await sender.sendChannelMessage(channelKey, teamId, channelId, messageText, now);
        return r.ok ? this.ok(route, r.messageId) : this.fail(req, route.channel, r.error ?? "teams_send_failed", route);
      }
      case "kakao_work":
      case "kakaowork": {
        const sender = this.opts.senders.kakaowork;
        const credentialRef = route.credentialRef ?? req.credentialRef;
        const target = route.target ?? req.staffContact;
        const targetType = str(route.meta?.targetType) ?? str(req.metadata?.targetType) ?? inferKakaoworkTargetType(target);
        if (!sender) return this.fail(req, "kakao_work", "kakaowork_sender_missing", route);
        if (!credentialRef) return this.fail(req, "kakao_work", "kakaowork_credential_missing", route);
        if (!target) return this.fail(req, "kakao_work", "kakaowork_target_missing", route);
        const r = targetType === "conversation"
          ? await sender.sendToConversation(credentialRef, target, messageText)
          : targetType === "email"
            ? await sender.sendByEmail(credentialRef, target, messageText)
            : await sender.sendToUser(credentialRef, target, messageText);
        return r.ok ? this.ok({ ...route, channel: "kakao_work" }, r.messageId) : this.fail(req, "kakao_work", r.error ?? "kakaowork_send_failed", route);
      }
      case "email":
      case "gmail":
      case "outlook": {
        const provider = normalizeEmailProvider(route.channel, route.meta?.provider ?? req.metadata?.provider);
        const sender = provider === "outlook" ? this.opts.senders.outlook : this.opts.senders.gmail;
        const to = emailRecipients(req, route);
        if (!sender) return this.fail(req, "email", `${provider}_sender_missing`, route);
        if (to.length === 0) return this.fail(req, "email", "email_recipient_missing", route);
        const r = await sender.send({
          to,
          cc: emailRecipients(req, route, "cc"),
          subject: str(req.metadata?.subject) ?? req.title,
          body: messageText,
          isHtml: req.metadata?.isHtml === true,
        }, now);
        return r.ok ? this.ok({ ...route, channel: "email" }, r.messageId, provider) : this.fail(req, "email", r.error ?? "email_send_failed", route, provider);
      }
      case "webhook":
      case "jandi": {
        const sender = this.opts.senders.webhook;
        const credentialRef = route.credentialRef ?? req.credentialRef;
        const flavor = normalizeWebhookFlavor(route.channel, route.meta?.flavor ?? req.metadata?.flavor ?? req.metadata?.webhookFlavor);
        if (!sender) return this.fail(req, "webhook", "webhook_sender_missing", route);
        if (!credentialRef) return this.fail(req, "webhook", "webhook_credential_missing", route);
        const r = await sender.send(credentialRef, flavor, { text: messageText });
        return r.ok ? this.ok({ ...route, channel: "webhook" }) : this.fail(req, "webhook", r.error ?? `webhook_http_${r.status ?? "unknown"}`, route);
      }
      case "sms": {
        return this.delegate(req, route, this.opts.senders.sms, "sms_sender_missing");
      }
      case "telegram": {
        return this.delegate(req, route, this.opts.senders.telegram, "telegram_sender_missing");
      }
      case "manual": {
        return this.delegate(req, route, this.opts.senders.manual, "manual_sender_missing");
      }
      default:
        return this.fail(req, route.channel, `unsupported_staff_channel:${route.channel}`, route);
    }
  }

  /** 요청 채널 우선, 없으면 우선순위/연결상태로 자동 선택 */
  async selectRoute(req: StaffConfirmationRequestDraft): Promise<StaffChannelRoute | null> {
    const explicit = this.routeFromRequest(req);
    const routes = (await this.opts.routeBook?.routesFor(req.companyId)) ?? [];
    const enabled = routes
      .filter((r) => r.enabled !== false)
      .map((r) => ({ ...r, channel: normalizeChannel(r.channel) }))
      .sort((a, b) => a.priority - b.priority);

    const wanted = normalizeChannel(req.channel);
    const isExplicit = wanted !== "manual";
    if (isExplicit) {
      const found = [...enabled, explicit].find((r): r is StaffChannelRoute => !!r && channelsEqual(r.channel, wanted));
      if (found) return found;
      // 요청 채널이 명시됐는데 routeBook이 없어도 req 안에 충분한 정보가 있으면 그 자체로 보낸다.
      return explicit;
    }

    const preferred = channelPreference(req, this.opts.defaultChannelOrder ?? DEFAULT_ORDER);
    for (const ch of preferred) {
      const found = [...enabled, explicit].find((r): r is StaffChannelRoute => !!r && channelsEqual(r.channel, ch));
      if (found) return found;
    }
    return enabled[0] ?? explicit ?? null;
  }

  private routeFromRequest(req: StaffConfirmationRequestDraft): StaffChannelRoute | null {
    const channel = normalizeChannel(req.channel);
    const credentialRef = req.credentialRef;
    const target = str(req.metadata?.channelTarget) ?? req.staffContact;
    const hasEnoughForDirect = channel !== "manual" && (
      !!credentialRef || channel === "email" || channel === "sms" || channel === "telegram"
    );
    if (!hasEnoughForDirect) return null;
    return {
      id: `request:${req.companyId}:${channel}`,
      companyId: req.companyId,
      channel,
      credentialRef,
      target,
      priority: 0,
      enabled: true,
      meta: req.metadata,
    };
  }

  private async delegate(
    req: StaffConfirmationRequestDraft,
    route: StaffChannelRoute,
    sender: StaffChannelSender | undefined,
    missing: string,
  ): Promise<StaffChannelSendResult> {
    if (!sender) return this.fail(req, route.channel, missing, route);
    const r = await sender.send({ ...req, channel: route.channel, credentialRef: route.credentialRef ?? req.credentialRef, staffContact: route.target ?? req.staffContact });
    return isSentStatus(r.status) ? this.ok(route) : this.fail(req, route.channel, `delegated_${r.status}`, route);
  }

  private ok(route: StaffChannelRoute, messageId?: string, provider?: string): StaffChannelSendResult {
    return { status: "sent", channel: normalizeChannel(route.channel), routeId: route.id, messageId, provider };
  }

  private fail(
    _req: StaffConfirmationRequestDraft,
    channel: StaffRequestChannel,
    error: string,
    route?: StaffChannelRoute,
    provider?: string,
  ): StaffChannelSendResult {
    return { status: "failed", channel: normalizeChannel(channel), routeId: route?.id, error, provider };
  }
}

function normalizeChannel(ch: StaffRequestChannel | string | undefined): StaffRequestChannel {
  switch ((ch ?? "manual").toLowerCase()) {
    case "gmail":
    case "outlook":
    case "mail":
    case "이메일":
      return "email";
    case "kakaowork":
    case "카카오워크":
      return "kakao_work";
    case "잔디":
    case "jandi":
      return "jandi";
    case "슬랙":
      return "slack";
    case "팀즈":
      return "teams";
    case "문자":
      return "sms";
    case "webhook":
    case "slack_incoming":
    case "discord":
      return "webhook";
    default:
      return (ch ?? "manual") as StaffRequestChannel;
  }
}

function channelsEqual(a: StaffRequestChannel, b: StaffRequestChannel): boolean {
  const na = normalizeChannel(a);
  const nb = normalizeChannel(b);
  if ((na === "webhook" && nb === "jandi") || (na === "jandi" && nb === "webhook")) return true;
  return na === nb;
}

function isSentStatus(status: string): boolean {
  return status === "sent" || status === "queued" || status === "ok";
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function channelPreference(req: StaffConfirmationRequestDraft, fallback: StaffRequestChannel[]): StaffRequestChannel[] {
  const raw = req.metadata?.preferredChannels;
  const arr = Array.isArray(raw) ? raw : [];
  const preferred = arr
    .map((v) => (typeof v === "string" ? normalizeChannel(v) : null))
    .filter((v): v is StaffRequestChannel => !!v);
  return preferred.length ? preferred : fallback;
}

function inferKakaoworkTargetType(target: string | undefined): "conversation" | "email" | "user" {
  if (!target) return "user";
  if (/^\d+$/.test(target)) return "conversation";
  if (target.includes("@")) return "email";
  return "user";
}

function normalizeEmailProvider(channel: StaffRequestChannel, provider: unknown): "gmail" | "outlook" {
  if (channel === "outlook" || provider === "outlook") return "outlook";
  return "gmail";
}

function normalizeWebhookFlavor(channel: StaffRequestChannel, raw: unknown): WebhookFlavor {
  if (channel === "jandi" || raw === "jandi") return "jandi";
  if (raw === "discord") return "discord";
  if (raw === "slack_incoming") return "slack_incoming";
  return "generic";
}

function emailRecipients(
  req: StaffConfirmationRequestDraft,
  route: StaffChannelRoute,
  kind: "to" | "cc" = "to",
): EmailAddress[] {
  const key = kind === "to" ? "to" : "cc";
  const raw = kind === "to"
    ? req.metadata?.to ?? route.target ?? req.staffContact
    : req.metadata?.[key];
  if (!raw) return [];
  if (typeof raw === "string") return raw.split(/[;,]/).map((email) => email.trim()).filter(Boolean).map((email) => ({ email }));
  if (Array.isArray(raw)) {
    return raw.flatMap((v) => {
      if (typeof v === "string") return [{ email: v }];
      if (typeof v === "object" && v && typeof (v as { email?: unknown }).email === "string") {
        const r = v as { email: string; name?: unknown };
        return [{ email: r.email, name: typeof r.name === "string" ? r.name : undefined }];
      }
      return [];
    });
  }
  return [];
}
