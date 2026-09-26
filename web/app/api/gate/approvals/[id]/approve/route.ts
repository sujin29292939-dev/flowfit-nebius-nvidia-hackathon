import { type NextRequest } from "next/server";

import { gateOptionsResponse, proxyGateAdmin, requireGateAdmin } from "@/lib/gate-proxy";

export const runtime = "nodejs";

export function OPTIONS() {
  return gateOptionsResponse();
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireGateAdmin(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  return proxyGateAdmin(`/v1/gate/approvals/${encodeURIComponent(params.id)}/approve`, body);
}
