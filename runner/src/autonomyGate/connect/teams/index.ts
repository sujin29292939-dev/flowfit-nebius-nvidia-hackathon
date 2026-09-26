// connect/teams/index.ts — 팀즈 OAuth 공개 API + 검증기
export * from "./config.js";
export * from "./teamsOAuthBroker.js";

import type { ConnectionVerifier } from "../types.js";
import { TeamsOAuthBroker } from "./teamsOAuthBroker.js";
import { GRAPH_ME_URL } from "./config.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** 검증: 유효 토큰 확보 후 Graph /me 호출이 성공하면 연결 확인 */
export class TeamsVerifier implements ConnectionVerifier {
  constructor(
    private broker: TeamsOAuthBroker,
    private fetchFn: FetchFn = fetch,
  ) {}

  async verify(channelId: string, _credentialRef: string): Promise<boolean> {
    const token = await this.broker.validAccessToken(channelId);
    if (!token) return false;
    try {
      const res = await this.fetchFn(GRAPH_ME_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
