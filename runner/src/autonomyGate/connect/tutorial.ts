// connect/tutorial.ts
// 튜토리얼 자동 실행 + 검증/데모용 포트 구현.
// 운영에서는 MemoryVault → 보안 저장소, MockOAuthBroker → 실제 OAuth 서버,
// MockVerifier → 채널별 핑 테스트로 교체한다.

import type {
  CredentialVault,
  OAuthBroker,
  ConnectionVerifier,
  WizardStep,
} from "./types.js";
import { ConnectionWizard } from "./wizard.js";

// ── 메모리 포트 구현 (데모/검증) ──────────────────────────────────────────────

export class MemoryVault implements CredentialVault {
  private store_ = new Map<string, { secret: string; expiresAt?: string }>();
  private seq = 0;
  store(channelId: string, secret: string, expiresAt?: string): string {
    this.seq += 1;
    const ref = `cred:${channelId}:${this.seq}`;
    this.store_.set(ref, { secret, expiresAt });
    return ref;
  }
  has(ref: string): boolean {
    return this.store_.has(ref);
  }
  revoke(ref: string): void {
    this.store_.delete(ref);
  }
}

export class MockOAuthBroker implements OAuthBroker {
  buildAuthUrl(channelId: string, state: string): string {
    return `https://auth.example/${channelId}?state=${state}`;
  }
  exchangeCode(_channelId: string, code: string): { secret: string; expiresAt?: string } {
    if (code === "BAD") throw new Error("invalid_code");
    return { secret: `token-${code}`, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  }
}

export class MockVerifier implements ConnectionVerifier {
  constructor(private failChannels: Set<string> = new Set()) {}
  verify(channelId: string, _ref: string): boolean {
    return !this.failChannels.has(channelId);
  }
}

// ── 튜토리얼 자동 실행 ────────────────────────────────────────────────────────

export interface TutorialResult {
  steps: WizardStep[];
  /** 사용자 행동이 필요한 단계만 추린 것 (UI가 순서대로 보여줌) */
  actionable: WizardStep[];
  /** 연결 불필요로 즉시 끝난 채널 */
  autoConnected: string[];
}

/**
 * 첫 실행 튜토리얼에서 자동 호출.
 * 사용자가 체크한 채널을 받아 마법사를 시작하고, 보여줄 단계를 정리해 돌려준다.
 * 별도 설치 없이 같은 패키지에서 즉시 동작한다.
 */
export function runTutorialConnect(
  wizard: ConnectionWizard,
  checkedChannels: string[],
): TutorialResult {
  const steps = wizard.begin(checkedChannels);
  return {
    steps,
    actionable: steps.filter((s) => s.status === "awaiting_user_action"),
    autoConnected: steps.filter((s) => s.status === "connected").map((s) => s.channelId),
  };
}

/** 추후 채팅에서 "팀즈도 연결해줘" 같은 추가 요청 처리 */
export function addChannelsFromChat(
  wizard: ConnectionWizard,
  channels: string[],
): TutorialResult {
  return runTutorialConnect(wizard, channels);
}
