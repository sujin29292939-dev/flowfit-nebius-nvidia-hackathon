import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

import { validateIntakeAccess } from "@/services/intakeAccessService";
import { validateStaffIntakeLogin } from "@/services/staffIntakeAuth";

export const runtime = "nodejs";

const INTAKE_SESSION_COOKIE = "flowfit_intake_session";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getIntakeAccessCode() {
  return process.env.FLOWFIT_INTAKE_ACCESS_CODE ?? "flowfit-intake-0429";
}

function getIntakeSessionSecret() {
  return process.env.FLOWFIT_INTAKE_SESSION_TOKEN ?? "flowfit-intake-session-local";
}

function makeSessionValue(companySlug: string, token?: string) {
  return `${getIntakeSessionSecret()}:${companySlug}:${token ?? "public"}`;
}

function makeStaffSessionValue(companySlug: string, staffId: string) {
  return `${getIntakeSessionSecret()}:staff:${companySlug}:${staffId}`;
}

function isHttps(request: NextRequest) {
  return request.nextUrl.protocol === "https:";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    companySlug?: string;
    token?: string;
    accessCode?: string;
    staffId?: string;
    password?: string;
  } | null;

  const companySlug = body?.companySlug?.trim() ?? "";
  const token = body?.token?.trim() || undefined;
  const staffId = body?.staffId?.trim() ?? "";
  const password = body?.password ?? "";
  const accessCode = body?.accessCode ?? "";

  if (staffId || password) {
    const staffLogin = validateStaffIntakeLogin({ companySlug, staffId, password });

    if (!staffLogin.ok) {
      return NextResponse.json({ error: "직원 ID 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    const response = NextResponse.json({
      ok: true,
      companyId: staffLogin.companyId,
      companySlug: staffLogin.companySlug,
      staffId: staffLogin.staffId,
      staffName: staffLogin.staffName,
    });
    response.cookies.set(INTAKE_SESSION_COOKIE, makeStaffSessionValue(staffLogin.companySlug, staffLogin.staffId), {
      httpOnly: true,
      sameSite: "strict",
      secure: isHttps(request),
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return response;
  }

  if (!companySlug || !safeEqual(accessCode, getIntakeAccessCode())) {
    return NextResponse.json({ error: "접수 로그인 정보가 올바르지 않습니다." }, { status: 401 });
  }

  const access = validateIntakeAccess(companySlug, token);
  if (!access.ok) {
    return NextResponse.json({ error: "접수 링크가 만료되었거나 폐기되었습니다." }, { status: 401 });
  }

  const response = NextResponse.json({
    ok: true,
    companyId: access.companyId,
    companySlug,
    staffId: access.access?.staffId,
    staffName: access.staffName || "현장 직원",
  });
  response.cookies.set(INTAKE_SESSION_COOKIE, makeSessionValue(companySlug, token), {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(request),
    path: "/",
    maxAge: 60 * 60 * 4,
  });
  return response;
}
