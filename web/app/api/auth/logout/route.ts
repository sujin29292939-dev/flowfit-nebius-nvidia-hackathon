import { NextResponse, type NextRequest } from "next/server";

function isHttps(request: NextRequest) {
  return request.nextUrl.protocol === "https:";
}

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("flowfit_admin_session", "", {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(request),
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("flowfit_intake_session", "", {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(request),
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("flowfit_intake_session", "", {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(request),
    path: "/intake",
    maxAge: 0,
  });
  return response;
}
