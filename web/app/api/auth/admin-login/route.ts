import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicGateBridgeConfig } from "@/lib/gate-proxy";

export const runtime = "nodejs";

const ADMIN_SESSION_COOKIE = "flowfit_admin_session";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getAdminUser() {
  return process.env.FLOWFIT_ADMIN_USER ?? "owner";
}

function getAdminPassword() {
  return process.env.FLOWFIT_ADMIN_PASSWORD ?? "1111";
}

function getAdminSessionToken() {
  return process.env.FLOWFIT_ADMIN_SESSION_TOKEN ?? "flowfit-admin-session-local";
}

function isHttps(request: NextRequest) {
  return request.nextUrl.protocol === "https:";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { userId?: string; password?: string } | null;
  const userId = body?.userId?.trim() ?? "";
  const password = body?.password ?? "";

  if (!safeEqual(userId, getAdminUser()) || !safeEqual(password, getAdminPassword())) {
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const response = NextResponse.json({
    ok: true,
    bridge: {
      ...getPublicGateBridgeConfig(request),
      sessionId: `flowfit-admin-${Date.now()}`,
    },
  });
  response.cookies.set(ADMIN_SESSION_COOKIE, getAdminSessionToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(request),
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
