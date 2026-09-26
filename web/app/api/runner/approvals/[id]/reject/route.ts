import { NextResponse } from "next/server";

import { decideRunnerApproval, RunnerConfigError } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = (await request.json().catch(() => ({}))) as { note?: unknown; resolvedBy?: unknown };

  try {
    const result = await decideRunnerApproval({
      approvalId: params.id,
      decision: "reject",
      note: typeof body.note === "string" ? body.note : undefined,
      resolvedBy: typeof body.resolvedBy === "string" ? body.resolvedBy : "owner",
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner 반려 처리에 실패했습니다.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
