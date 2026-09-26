/**
 * connectorExecutor.ts
 * ------------------------------------------------------------------
 * 발견→실행의 마지막 조각.
 * resolve()가 고른 커넥터 + 고정된 MappingProfile로 실제 HTTP를 호출한다.
 * profile.endpoint.path 를 형변환·추측 없이 그대로 꺼내 쓴다 (타입이 이어졌으므로).
 *
 * 안전: actionGuard(권한) → autonomyGate(자동/승인) 통과 후에만 이 실행기가 불린다.
 *       실행기 자신은 "검증된 프로파일이 들어온다"고 가정한다.
 * ------------------------------------------------------------------
 */
import type { MappingProfile } from "./connectorTypes.js";
import type { ResolvedConnector } from "./connectorResolver.js";

/** 망 비의존: fetch를 포트로 주입 */
export interface HttpPort {
  request(args: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; json: unknown }>;
}

/** 자격증명을 인증 방식에 맞게 요청에 실는다. credential은 로그에 남기지 않는다. */
function applyAuth(
  profile: MappingProfile,
  credential: string,
  url: URL,
  headers: Record<string, string>,
): void {
  switch (profile.authType) {
    case "bearer":
    case "oauth":
      headers["Authorization"] = `Bearer ${credential}`;
      break;
    case "api_key_header":
      headers[profile.authParam ?? "X-API-KEY"] = credential;
      break;
    case "api_key_query":
      url.searchParams.set(profile.authParam ?? "api_key", credential);
      break;
    case "none":
      break;
  }
}

export interface ExecuteResult {
  ok: boolean;
  status: number;
  data: unknown;
  idempotency: {
    supported: boolean;
    applied: boolean;
    key?: string;
    headerName?: string;
    bodyField?: string;
  };
}

/** profile + credential로 실제 HTTP 요청 인자를 조립한다. validator와 공유. */
export function buildHttpCall(
  profile: MappingProfile,
  credential: string,
  override?: { method?: string; path?: string },
): { url: string; method: string; headers: Record<string, string> } {
  const url = new URL(override?.path ?? profile.endpoint.path, profile.baseUrl);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  applyAuth(profile, credential, url, headers);
  return {
    url: url.toString(),
    method: override?.method ?? profile.endpoint.method,
    headers,
  };
}

/**
 * resolve() 산출물로 실제 호출.
 * profile이 없으면(아직 발견 전) 실행 거부 — 발견 루프를 먼저 태워야 한다.
 */
export async function executeViaConnector(
  resolved: ResolvedConnector,
  profile: MappingProfile | undefined,
  http: HttpPort,
  payload?: Record<string, unknown>,
): Promise<ExecuteResult> {
  if (!profile) {
    throw new Error(
      `[executor] connector '${resolved.connectorKey}' 의 MappingProfile이 없습니다. ` +
        `먼저 discoverConnector로 발견·검증·고정해야 합니다.`,
    );
  }

  const call = buildHttpCall(profile, resolved.credential);
  const idempotencyKey = typeof payload?.taskId === "string" ? payload.taskId : undefined;
  const idempotency = profile.idempotency ?? { supported: false };
  const idempotencyApplied = Boolean(idempotency.supported && idempotencyKey);
  const requestPayload = { ...(payload ?? {}) };

  if (idempotencyApplied && idempotencyKey) {
    if (idempotency.bodyField) {
      requestPayload[idempotency.bodyField] = idempotencyKey;
    }
    const headerName = idempotency.headerName ?? (idempotency.bodyField ? undefined : "Idempotency-Key");
    if (headerName) {
      call.headers[headerName] = idempotencyKey;
    }
  }

  try {
    const res = await http.request({
      url: call.url,
      method: call.method,
      headers: call.headers,
      body: Object.keys(requestPayload).length > 0 ? JSON.stringify(requestPayload) : undefined,
    });

    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      data: res.json,
      idempotency: {
        supported: idempotency.supported,
        applied: idempotencyApplied,
        key: idempotencyApplied ? idempotencyKey : undefined,
        headerName: idempotencyApplied ? idempotency.headerName ?? (idempotency.bodyField ? undefined : "Idempotency-Key") : undefined,
        bodyField: idempotencyApplied ? idempotency.bodyField : undefined,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { error: error instanceof Error ? error.message : String(error) },
      idempotency: {
        supported: idempotency.supported,
        applied: idempotencyApplied,
        key: idempotencyApplied ? idempotencyKey : undefined,
        headerName: idempotencyApplied ? idempotency.headerName ?? (idempotency.bodyField ? undefined : "Idempotency-Key") : undefined,
        bodyField: idempotencyApplied ? idempotency.bodyField : undefined,
      },
    };
  }
}
