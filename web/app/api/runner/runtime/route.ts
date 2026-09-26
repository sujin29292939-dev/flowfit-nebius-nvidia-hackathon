import { NextResponse } from "next/server";

import { getRunnerAiRuntime, RunnerConfigError } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getRunnerAiRuntime());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner AI runtime lookup failed.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message, status: "not_configured" }, { status });
  }
}
