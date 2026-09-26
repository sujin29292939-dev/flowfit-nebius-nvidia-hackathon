import { NextResponse } from "next/server";

import { createDevicePairingCode, listDevices, RunnerConfigError } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof RunnerConfigError) {
    return NextResponse.json({ error: error.message, code: "runner_not_configured" }, { status: 503 });
  }
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 502 });
}

export async function GET(request: Request) {
  try {
    const companyId = new URL(request.url).searchParams.get("companyId") ?? undefined;
    return NextResponse.json(await listDevices(companyId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      companyId?: string;
      label?: string;
      expiresInHours?: number;
    };
    return NextResponse.json(await createDevicePairingCode(body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
