import { NextResponse } from "next/server";

import {
  decideRunnerTask,
  executeRunnerTask,
  getRunnerTaskTimeline,
  getRunnerTasks,
  RunnerConfigError,
} from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId");
    const action = url.searchParams.get("action");

    if (taskId && action === "timeline") {
      return NextResponse.json(await getRunnerTaskTimeline(taskId));
    }

    return NextResponse.json(await getRunnerTasks());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner task lookup failed.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message, count: 0, tasks: [] }, { status });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { taskId?: unknown; action?: unknown };
  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  const action = typeof body.action === "string" ? body.action : "";

  if (!taskId || !action) {
    return NextResponse.json({ error: "taskId and action are required" }, { status: 400 });
  }

  try {
    if (action === "execute") {
      return NextResponse.json(await executeRunnerTask(taskId));
    }
    if (action === "decide") {
      return NextResponse.json(await decideRunnerTask(taskId));
    }
    return NextResponse.json({ error: `Unsupported task action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner task action failed.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
