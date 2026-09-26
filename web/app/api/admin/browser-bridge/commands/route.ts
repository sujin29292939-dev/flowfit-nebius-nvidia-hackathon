import { NextResponse } from "next/server";

import { createBrowserBridgeCommand } from "@/lib/browser-automation-bridge";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    command?: string;
    label?: string;
    targetUrl?: string | null;
    params?: Record<string, unknown>;
  };

  if (!body.command) {
    return NextResponse.json({ error: "command_required" }, { status: 400 });
  }

  try {
    const command = await createBrowserBridgeCommand({
      command: body.command,
      label: body.label,
      targetUrl: body.targetUrl,
      params: body.params,
    });
    return NextResponse.json({ ok: true, command }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "browser_bridge_command_failed" },
      { status: 502 }
    );
  }
}
