import { NextResponse } from "next/server";

import { RunnerConfigError, startRunnerRun, type RunnerPriority } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePriority(value: unknown): RunnerPriority {
  return value === "high" || value === "low" || value === "normal" ? value : "normal";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { task?: unknown; priority?: unknown; executionBrief?: unknown } | null;
  const task = typeof body?.task === "string" ? body.task.trim() : "";

  if (!task) {
    return NextResponse.json({ error: "task is required" }, { status: 400 });
  }

  try {
    const run = await startRunnerRun({
      task: task.slice(0, 8000),
      priority: normalizePriority(body?.priority),
      executionBrief: body?.executionBrief,
    });
    return NextResponse.json(run, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner 요청에 실패했습니다.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
