import { NextResponse } from "next/server";

import { getRunnerTaskTimeline, RunnerConfigError } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(await getRunnerTaskTimeline(params.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner task timeline lookup failed.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message, taskId: params.id, count: 0, items: [] }, { status });
  }
}
