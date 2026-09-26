import { NextResponse } from "next/server";

import { provisionRunnerSession, RunnerConfigError } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof RunnerConfigError) {
    return NextResponse.json({ error: error.message, code: "runner_not_configured" }, { status: 503 });
  }
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 502 });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token : "";
    if (!token.trim()) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    return NextResponse.json(
      await provisionRunnerSession({
        token,
        deviceLabel: typeof body.deviceLabel === "string" ? body.deviceLabel : undefined,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
