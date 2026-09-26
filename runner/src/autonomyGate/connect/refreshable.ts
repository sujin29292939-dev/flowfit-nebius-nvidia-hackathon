// connect/refreshable.ts
// 재사용 가능한 토큰 갱신 부품.
// access token이 만료되는 OAuth 채널(팀즈·구글·네이버웍스 등) 전부가 공유한다.
// 핵심: 만료 임박 시 refresh_token으로 새 access token을 자동 발급하고,
// 새 refresh_token이 오면 그것으로 교체한다(회전 대응).

/** 한 채널의 토큰 묶음 (access + refresh + 만료) */
export interface TokenBundle {
  accessToken: string;
  refreshToken?: string;
  /** access token 만료 시각 (ISO) */
  expiresAt: string;
  scope?: string;
}

/** refresh_token으로 새 토큰을 발급하는 함수. 채널별로 구현 주입 */
export type RefreshFn = (refreshToken: string) => Promise<TokenBundle>;

/** 토큰 묶음을 보관하는 포트. 운영에서는 보안 저장소로 교체 */
export interface TokenBundleStore {
  get(channelKey: string): Promise<TokenBundle | null> | TokenBundle | null;
  put(channelKey: string, bundle: TokenBundle): Promise<void> | void;
}

export class MemoryTokenBundleStore implements TokenBundleStore {
  private m = new Map<string, TokenBundle>();
  get(k: string): TokenBundle | null {
    return this.m.get(k) ?? null;
  }
  put(k: string, b: TokenBundle): void {
    this.m.set(k, b);
  }
}

/**
 * 만료 임박이면 자동 갱신해 유효한 access token을 돌려준다.
 * 어떤 OAuth 채널이든 RefreshFn만 주입하면 이 갱신 로직을 공유한다.
 */
export class RefreshableTokens {
  constructor(
    private store: TokenBundleStore,
    /** 만료 몇 ms 전부터 미리 갱신할지 (기본 60초) */
    private skewMs: number = 60_000,
  ) {}

  /** 유효한 access token 반환 (필요 시 갱신). 갱신 불가면 null */
  async getValidAccessToken(
    channelKey: string,
    refresh: RefreshFn,
    now: number = Date.now(),
  ): Promise<string | null> {
    const bundle = await this.store.get(channelKey);
    if (!bundle) return null;

    const expMs = new Date(bundle.expiresAt).getTime();
    const stillFresh = expMs - this.skewMs > now;
    if (stillFresh) return bundle.accessToken;

    // 만료 임박/만료 — refresh_token으로 갱신
    if (!bundle.refreshToken) return null;
    const refreshed = await refresh(bundle.refreshToken);
    // 새 refresh_token이 오면 교체(회전), 안 오면 기존 유지
    const next: TokenBundle = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? bundle.refreshToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope ?? bundle.scope,
    };
    await this.store.put(channelKey, next);
    return next.accessToken;
  }

  /** 최초 연결 시 토큰 묶음 저장 */
  async save(channelKey: string, bundle: TokenBundle): Promise<void> {
    await this.store.put(channelKey, bundle);
  }
}

/** expires_in(초) → ISO 만료 시각 */
export function expiresInToIso(expiresInSec: number, now: number = Date.now()): string {
  return new Date(now + expiresInSec * 1000).toISOString();
}
