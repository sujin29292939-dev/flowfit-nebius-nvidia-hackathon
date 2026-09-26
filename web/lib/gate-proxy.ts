import "server-only";

// [LEGACY] flowfit-local-engine.js(포트 3001)의 /v1/gate/* 로컬 엔진 경로 프록시.
// 재정렬 v1 이후 명령 큐·게이트 정책은 Runner(/devices/*)로 이관되었다.
// 신규 원격 실행 에이전트는 이 gate 레일이 아니라 /api/runner/devices/* 와
// Runner 직접 교신(/devices/:id/commands, /results)을 사용한다.
// 이 파일은 기존 브라우저 확장 호환을 위해 유지하며, 확장 이전 완료 후 제거 대상이다.

import { NextResponse, type NextRequest } from "next/server";

const DEFAULT_ENGINE_BASE_URL = "http://127.0.0.1:3001";
const DEFAULT_ADMIN_TOKEN = "dev-mobile-admin-token";
const DEFAULT_EXTENSION_TOKEN = "dev-browser-bridge-token";

const engineBaseUrl = (
  process.env.FLOWFIT_BROWSER_ENGINE_BASE_URL ??
  process.env.FLOWFIT_MOBILE_ENGINE_BASE_URL ??
  process.env.FLOWFIT_ENGINE_BASE_URL ??
  DEFAULT_ENGINE_BASE_URL
).replace(/\/$/, "");

const adminToken =
  process.env.FLOWFIT_GATE_AGENT_TOKEN ??
  process.env.FLOWFIT_MOBILE_ADMIN_TOKEN ??
  process.env.MOBILE_ADMIN_TOKEN ??
  DEFAULT_ADMIN_TOKEN;

const extensionToken =
  process.env.FLOWFIT_BROWSER_BRIDGE_TOKEN ??
  process.env.FLOWFIT_AGENT_BRIDGE_TOKEN ??
  DEFAULT_EXTENSION_TOKEN;

const adminSessionToken = process.env.FLOWFIT_ADMIN_SESSION_TOKEN ?? "flowfit-admin-session-local";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Session-ID",
};

export function gateOptionsResponse() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export function requireGateAdmin(request: NextRequest) {
  const sessionCookie = request.cookies.get("flowfit_admin_session")?.value;
  const rawAuth = request.headers.get("authorization") ?? "";
  const bearer = rawAuth.toLowerCase().startsWith("bearer ") ? rawAuth.slice(7).trim() : "";

  if (sessionCookie === adminSessionToken || bearer === adminToken) {
    return null;
  }

  return NextResponse.json(
    { error: "관리자 로그인 또는 Gate agent token이 필요합니다." },
    { status: 401, headers: corsHeaders },
  );
}

function bearerFrom(request: NextRequest) {
  const raw = request.headers.get("authorization") ?? "";
  return raw.toLowerCase().startsWith("bearer ") ? raw : "";
}

export function requireGateExtension(request: NextRequest) {
  const rawAuth = request.headers.get("authorization") ?? "";
  const bearer = rawAuth.toLowerCase().startsWith("bearer ") ? rawAuth.slice(7).trim() : "";

  if (bearer === extensionToken || bearer === adminToken) {
    return null;
  }

  return NextResponse.json(
    { error: "FlowFit Gate extension token이 필요합니다." },
    { status: 401, headers: corsHeaders },
  );
}

async function proxyJson(pathname: string, init: RequestInit) {
  const response = await fetch(`${engineBaseUrl}${pathname}`, {
    ...init,
    cache: "no-store",
  });
  const text = await response.text();

  return new NextResponse(text || "{}", {
    status: response.status,
    headers: {
      ...corsHeaders,
      "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
    },
  });
}

export async function proxyGateAdmin(pathname: string, body?: unknown) {
  return proxyJson(pathname, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function proxyGateExtension(request: NextRequest, pathname: string, body?: unknown) {
  const sessionId = request.headers.get("x-session-id");
  return proxyJson(pathname, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: bearerFrom(request),
      "Content-Type": "application/json",
      ...(sessionId ? { "X-Session-ID": sessionId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function getPublicGateBridgeConfig(request: NextRequest) {
  const explicitServerUrl = process.env.FLOWFIT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const serverUrl = explicitServerUrl ?? request.nextUrl.origin;
  return {
    serverUrl,
    authToken: extensionToken,
    pollIntervalMs: 1500,
  };
}
