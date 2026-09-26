import { type NextRequest } from "next/server";

import { gateOptionsResponse, proxyGateExtension, requireGateExtension } from "@/lib/gate-proxy";

export const runtime = "nodejs";

export function OPTIONS() {
  return gateOptionsResponse();
}

export async function POST(request: NextRequest) {
  const unauthorized = requireGateExtension(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  return proxyGateExtension(request, "/v1/gate/result", body);
}
