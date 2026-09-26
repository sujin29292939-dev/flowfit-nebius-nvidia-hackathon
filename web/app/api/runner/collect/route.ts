import { NextResponse } from "next/server";

import { collectRunnerSiteIntake, RunnerConfigError } from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown; sourceName?: unknown; title?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await collectRunnerSiteIntake({
      text: text.slice(0, 8000),
      sourceName: typeof body?.sourceName === "string" ? body.sourceName : undefined,
      title: typeof body?.title === "string" ? body.title : undefined,
    }), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner 수집에 실패했습니다.";
    const status = error instanceof RunnerConfigError ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
