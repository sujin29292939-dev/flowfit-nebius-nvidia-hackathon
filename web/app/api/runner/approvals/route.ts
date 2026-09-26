import { NextResponse } from "next/server";

import { getRunnerApprovals, RunnerConfigError } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    const approvals = await getRunnerApprovals({
      status: url.searchParams.get("status") ?? "pending",
      companyId: url.searchParams.get("companyId") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 50),
    });
    return NextResponse.json(approvals);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner 승인 목록 조회에 실패했습니다.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message, aiWorkItems: [] }, { status });
  }
}
