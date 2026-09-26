// connect/wizard.ts
// 연결 마법사 본체. 별도 앱이 아니라 같은 패키지의 한 모듈.
// 사용자는 (1) 쓸 채널 체크 (2) oauth면 버튼 한 번 / 키면 붙여넣기 한 번. 그게 전부.
// 비밀번호는 이 모듈을 절대 거치지 않는다.

import type {
  ConnectionState,
  WizardStep,
  CredentialVault,
  OAuthBroker,
  ConnectionVerifier,
  WizardEventSink,
} from "./types.js";
import { getChannel, type ChannelDef } from "./catalog.js";

export interface WizardDeps {
  vault: CredentialVault;
  oauth: OAuthBroker;
  verifier: ConnectionVerifier;
  events?: WizardEventSink;
}

export class ConnectionWizard {
  private states = new Map<string, ConnectionState>();

  constructor(private deps: WizardDeps) {}

  private now(): string {
    return new Date().toISOString();
  }

  private set(channelId: string, patch: Partial<ConnectionState>): ConnectionState {
    const prev = this.states.get(channelId) ?? {
      channelId,
      status: "not_started" as const,
      updatedAt: this.now(),
    };
    const next: ConnectionState = { ...prev, ...patch, channelId, updatedAt: this.now() };
    this.states.set(channelId, next);
    this.deps.events?.emit("connect.state", { channelId, status: next.status });
    return next;
  }

  /**
   * (1) 튜토리얼/채팅에서 사용자가 체크한 채널 목록 → 마법사 단계 생성.
   * internal 채널은 연결 불필요로 즉시 connected 처리.
   */
  begin(channelIds: string[]): WizardStep[] {
    const steps: WizardStep[] = [];
    for (const id of channelIds) {
      const def = getChannel(id);
      if (!def) continue;

      if (def.method === "internal") {
        this.set(id, { status: "connected" });
        steps.push(this.step(def, "connected"));
        continue;
      }
      this.set(id, { status: "awaiting_user_action" });
      steps.push(this.step(def, "awaiting_user_action"));
    }
    this.deps.events?.emit("connect.begin", { channels: channelIds });
    return steps;
  }

  /** oauth 채널: 동의 화면 URL을 만들어 "여기 누르세요"로 사용자에게 제공 */
  async startOAuth(channelId: string): Promise<WizardStep> {
    const def = getChannel(channelId);
    if (!def || def.method !== "oauth") {
      return this.failStep(channelId, "oauth 대상이 아님");
    }
    const url = await this.deps.oauth.buildAuthUrl(channelId, channelId);
    this.set(channelId, { status: "awaiting_user_action" });
    const s = this.step(def, "awaiting_user_action");
    s.actionUrl = url; // 사용자가 클릭할 동의 화면
    return s;
  }

  /**
   * oauth 콜백: 외부 서비스가 사용자 로그인+허용 후 돌려준 인가코드를 토큰으로 교환.
   * 비밀번호는 외부 서비스가 처리했고, 우리는 코드→토큰만 받는다.
   */
  async completeOAuth(channelId: string, code: string): Promise<WizardStep> {
    const def = getChannel(channelId);
    if (!def) return this.failStep(channelId, "알 수 없는 채널");
    this.set(channelId, { status: "verifying" });
    try {
      const { secret, expiresAt } = await this.deps.oauth.exchangeCode(channelId, code);
      const ref = await this.deps.vault.store(channelId, secret, expiresAt);
      const ok = await this.deps.verifier.verify(channelId, ref);
      if (!ok) return this.failStep(channelId, "연결 확인 실패");
      this.set(channelId, { status: "connected", credentialRef: ref, expiresAt });
      return this.step(def, "connected");
    } catch (e) {
      return this.failStep(channelId, String(e));
    }
  }

  /**
   * api_key/webhook 채널: 사용자가 붙여넣은 키/URL을 저장·검증.
   * 이건 비밀번호가 아니라 사용자가 발급한 전용 키다.
   */
  async submitSecret(channelId: string, secret: string): Promise<WizardStep> {
    const def = getChannel(channelId);
    if (!def) return this.failStep(channelId, "알 수 없는 채널");
    if (def.method !== "api_key" && def.method !== "webhook") {
      return this.failStep(channelId, "키 입력 대상이 아님 (oauth 채널)");
    }
    if (!secret || secret.trim().length < 4) {
      return this.failStep(channelId, "키/주소가 비었거나 너무 짧음");
    }
    this.set(channelId, { status: "verifying" });
    try {
      const ref = await this.deps.vault.store(channelId, secret.trim());
      const ok = await this.deps.verifier.verify(channelId, ref);
      if (!ok) {
        await this.deps.vault.revoke(ref);
        return this.failStep(channelId, "키/주소 검증 실패");
      }
      this.set(channelId, { status: "connected", credentialRef: ref });
      return this.step(def, "connected");
    } catch (e) {
      return this.failStep(channelId, String(e));
    }
  }

  /** 만료 임박 토큰 목록 (자동 갱신 대상) */
  expiring(withinMs: number, now: number = Date.now()): string[] {
    const out: string[] = [];
    for (const s of this.states.values()) {
      if (s.status !== "connected" || !s.expiresAt) continue;
      if (new Date(s.expiresAt).getTime() - now <= withinMs) out.push(s.channelId);
    }
    return out;
  }

  state(channelId: string): ConnectionState | undefined {
    return this.states.get(channelId);
  }

  /** 전체 진행 요약 (튜토리얼 진행바용) */
  progress(): { total: number; connected: number; pending: number; failed: number } {
    const all = [...this.states.values()];
    return {
      total: all.length,
      connected: all.filter((s) => s.status === "connected").length,
      pending: all.filter((s) => s.status === "awaiting_user_action" || s.status === "verifying").length,
      failed: all.filter((s) => s.status === "failed").length,
    };
  }

  // ── 내부 ──
  private step(def: ChannelDef, status: ConnectionState["status"]): WizardStep {
    const needsInput = def.method === "api_key" || def.method === "webhook";
    return {
      channelId: def.id,
      label: def.label,
      status,
      instruction: status === "connected" ? `${def.label} 연결 완료` : def.userAction,
      actionUrl: def.startUrl,
      needsUserInput: needsInput && status !== "connected",
      inputLabel: needsInput ? (def.method === "webhook" ? "Webhook 주소" : "API 키") : undefined,
    };
  }

  private failStep(channelId: string, reason: string): WizardStep {
    this.set(channelId, { status: "failed", lastError: reason });
    const def = getChannel(channelId);
    return {
      channelId,
      label: def?.label ?? channelId,
      status: "failed",
      instruction: `연결 실패: ${reason}. 다시 시도할 수 있습니다.`,
      needsUserInput: false,
    };
  }
}
