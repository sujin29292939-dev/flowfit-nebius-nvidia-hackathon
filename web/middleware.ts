import { NextResponse, type NextRequest } from "next/server";

const ADMIN_SESSION_COOKIE = "flowfit_admin_session";

function getAdminSessionToken() {
  return process.env.FLOWFIT_ADMIN_SESSION_TOKEN ?? "flowfit-admin-session-local";
}

function getAllowedIps() {
  return (process.env.FLOWFIT_ALLOWED_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}

function getClientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "127.0.0.1"
  );
}

function isAdminProtectedPath(pathname: string) {
  return pathname === "/workspace" || pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
}

function isFirewallAllowed(request: NextRequest) {
  const allowedIps = getAllowedIps();
  if (!allowedIps.length) return true;

  const clientIp = getClientIp(request);
  return allowedIps.includes(clientIp) || (clientIp === "::1" && allowedIps.includes("127.0.0.1"));
}

function hasAdminSession(request: NextRequest) {
  return request.cookies.get(ADMIN_SESSION_COOKIE)?.value === getAdminSessionToken();
}

function withSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isAdminProtectedPath(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (!isFirewallAllowed(request)) {
    return withSecurityHeaders(new NextResponse("FlowFit app firewall blocked this request.", { status: 403 }));
  }

  if (!hasAdminSession(request)) {
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(NextResponse.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 }));
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
