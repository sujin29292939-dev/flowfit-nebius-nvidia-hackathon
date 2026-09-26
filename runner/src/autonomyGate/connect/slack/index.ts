// connect/slack/index.ts — 슬랙 OAuth 공개 API
export * from "./config.js";
export * from "./slackOAuthBroker.js";
export * from "./slackVerifier.js";

import type { CredentialVault } from "../types.js";
import type { TokenResolver } from "./slackVerifier.js";

/**
 * CredentialVault를 TokenResolver로 잇는 어댑터.
 * 단, 기본 CredentialVault 인터페이스는 값 반환이 없으므로(보안), 토큰 값을
 * 돌려줄 수 있는 보안 저장소가 이 resolve를 구현해야 한다.
 * 여기서는 vault가 reveal을 추가로 제공하는 경우를 위한 헬퍼만 정의한다.
 */
export interface RevealableVault extends CredentialVault {
  /** 참조로 실제 토큰 값을 꺼낸다 (서버 측, 감사 로깅 권장) */
  reveal(ref: string): Promise<string | null> | string | null;
}

export function vaultTokenResolver(vault: RevealableVault): TokenResolver {
  return { resolve: (ref) => vault.reveal(ref) };
}
