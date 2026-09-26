import { type NextRequest } from "next/server";

import { gateOptionsResponse, proxyGateExtension, requireGateExtension } from "@/lib/gate-proxy";

export const runtime = "nodejs";

export function OPTIONS() {
  return gateOptionsResponse();
}

export async function GET(request: NextRequest) {
  const unauthorized = requireGateExtension(request);
  if (unauthorized) return unauthorized;
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "default";
  return proxyGateExtension(request, `/v1/gate/poll?sessionId=${encodeURIComponent(sessionId)}`);
}
