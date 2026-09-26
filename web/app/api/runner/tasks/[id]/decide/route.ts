import { NextResponse } from "next/server";

import { decideRunnerTask, RunnerConfigError } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(await decideRunnerTask(params.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner task decision failed.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
