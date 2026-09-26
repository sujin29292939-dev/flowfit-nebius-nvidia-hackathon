import { NextResponse } from "next/server";

import { getRunnerStatus, RunnerConfigError } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { runId: string } }) {
  try {
    const status = await getRunnerStatus(params.runId);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner 상태 조회에 실패했습니다.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
