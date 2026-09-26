import { NextResponse } from "next/server";

import { getRunnerQueue, RunnerConfigError } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const queue = await getRunnerQueue();
    return NextResponse.json(queue);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner 큐 조회에 실패했습니다.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
