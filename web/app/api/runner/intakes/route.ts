import { NextResponse } from "next/server";

import { getRunnerIntakes, RunnerConfigError } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getRunnerIntakes());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner intake 조회에 실패했습니다.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message, count: 0, intakes: [] }, { status });
  }
}
