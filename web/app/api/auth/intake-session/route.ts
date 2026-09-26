import { NextResponse, type NextRequest } from "next/server";

import { companyIdFromSlug, findStaffIntakeAccount } from "@/services/staffIntakeAuth";

const INTAKE_SESSION_COOKIE = "flowfit_intake_session";

function getIntakeSessionSecret() {
  return process.env.FLOWFIT_INTAKE_SESSION_TOKEN ?? "flowfit-intake-session-local";
}

function makeSessionValue(companySlug: string, token?: string | null) {
  return `${getIntakeSessionSecret()}:${companySlug}:${token || "public"}`;
}

function getStaffSession(cookie: string | undefined, companySlug: string) {
  const prefix = `${getIntakeSessionSecret()}:staff:${companySlug}:`;
  if (!cookie?.startsWith(prefix)) return null;

  const staffId = cookie.slice(prefix.length);
  const account = findStaffIntakeAccount(companySlug, staffId);
  if (!account) return null;

  return account;
}

export async function GET(request: NextRequest) {
  const companySlug = request.nextUrl.searchParams.get("companySlug") ?? "";
  const token = request.nextUrl.searchParams.get("token");
  const cookie = request.cookies.get(INTAKE_SESSION_COOKIE)?.value;
  const staffSession = getStaffSession(cookie, companySlug);
  const tokenSession = Boolean(companySlug && cookie === makeSessionValue(companySlug, token));

  return NextResponse.json({
    authenticated: Boolean(staffSession || tokenSession),
    companyId: staffSession?.companyId ?? companyIdFromSlug(companySlug),
    companySlug,
    staffId: staffSession?.staffId,
    staffName: staffSession?.staffName,
  });
}
