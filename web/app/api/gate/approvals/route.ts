import { type NextRequest } from "next/server";

import { gateOptionsResponse, proxyGateAdmin, requireGateAdmin } from "@/lib/gate-proxy";

export const runtime = "nodejs";

export function OPTIONS() {
  return gateOptionsResponse();
}

export async function GET(_request: NextRequest) {
  const unauthorized = requireGateAdmin(_request);
  if (unauthorized) return unauthorized;
  return proxyGateAdmin("/v1/gate/approvals");
}
