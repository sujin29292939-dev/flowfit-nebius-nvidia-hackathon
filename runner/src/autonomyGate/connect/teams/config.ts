// connect/teams/config.ts
// MS 팀즈 (Azure AD / Microsoft Graph) OAuth 설정.
// 슬랙과 달리 테넌트(tenant) 개념이 있고, access token이 1시간 만료되어
// refresh_token 갱신이 필수다. offline_access scope가 있어야 갱신된다.
//
// ── 운영자가 Azure(Entra ID)에서 한 번 해야 하는 등록 ──
//  1. portal.azure.com > Entra ID > 앱 등록(App registration)
//  2. Redirect URI 등록 (TEAMS_REDIRECT_URI와 동일)
//  3. API 권한: ChannelMessage.Send / Chat.ReadWrite + offline_access(갱신용 필수)
//  4. 클라이언트 시크릿 발급
//  5. 환경변수 설정 — TEAMS_CLIENT_ID / TEAMS_CLIENT_SECRET / TEAMS_REDIRECT_URI / TEAMS_TENANT
//     (TEAMS_TENANT: 테넌트 ID 또는 도메인. 멀티테넌트면 "common")

export interface TeamsOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenant: string; // 테넌트 ID/도메인 또는 "common"
  scopes: string[];
}

const TENANT_BASE = "https://login.microsoftonline.com";
export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export function authorizeUrl(tenant: string): string {
  return `${TENANT_BASE}/${tenant}/oauth2/v2.0/authorize`;
}
export function tokenUrl(tenant: string): string {
  return `${TENANT_BASE}/${tenant}/oauth2/v2.0/token`;
}
export function channelMessageUrl(teamId: string, channelId: string): string {
  return `${GRAPH_BASE}/teams/${teamId}/channels/${channelId}/messages`;
}
export const GRAPH_ME_URL = `${GRAPH_BASE}/me`;

export function loadTeamsConfig(env: Record<string, string | undefined> = process.env): TeamsOAuthConfig {
  const clientId = env.TEAMS_CLIENT_ID;
  const clientSecret = env.TEAMS_CLIENT_SECRET;
  const redirectUri = env.TEAMS_REDIRECT_URI;
  const tenant = env.TEAMS_TENANT;

  const missing: string[] = [];
  if (!clientId) missing.push("TEAMS_CLIENT_ID");
  if (!clientSecret) missing.push("TEAMS_CLIENT_SECRET");
  if (!redirectUri) missing.push("TEAMS_REDIRECT_URI");
  if (!tenant) missing.push("TEAMS_TENANT");
  if (missing.length > 0) {
    throw new Error(
      `팀즈 OAuth 설정 누락: ${missing.join(", ")}. ` +
        `Azure 앱 등록(portal.azure.com)에서 발급 후 환경변수로 설정하세요.`,
    );
  }

  // offline_access는 refresh_token 발급에 필수 — 빠져 있으면 강제로 추가
  const scopes = (env.TEAMS_SCOPES ?? "ChannelMessage.Send Chat.ReadWrite offline_access")
    .split(/[ ,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!scopes.includes("offline_access")) scopes.push("offline_access");

  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri: redirectUri!, tenant: tenant!, scopes };
}
