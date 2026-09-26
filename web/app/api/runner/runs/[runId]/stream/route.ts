import { NextResponse } from "next/server";

import { getRunnerStreamPath, RunnerConfigError, runnerFetch } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { runId: string } }) {
  try {
    const upstream = await runnerFetch(getRunnerStreamPath(params.runId), {
      headers: {
        Accept: "text/event-stream",
      },
    });

    if (!upstream.ok || !upstream.body) {
      const body = await upstream.json().catch(() => ({}));
      return NextResponse.json(
        { error: typeof body?.error === "string" ? body.error : `Runner stream failed: ${upstream.status}` },
        { status: upstream.status },
      );
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner 스트림 연결에 실패했습니다.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
