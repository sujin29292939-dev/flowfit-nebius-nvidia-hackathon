import { NextResponse } from "next/server";

import {
  enqueueDeviceCommand,
  revokeDevice,
  setDeviceStage,
  RunnerConfigError,
} from "@/services/runnerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof RunnerConfigError) {
    return NextResponse.json({ error: error.message, code: "runner_not_configured" }, { status: 503 });
  }
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 502 });
}

// POST /api/runner/devices/:id  { action: "revoke" | "stage" | "command", ... }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "revoke") {
      return NextResponse.json(await revokeDevice(id));
    }

    if (action === "stage") {
      const stage = body.stage;
      if (stage !== "SHADOW" && stage !== "ASSIST" && stage !== "AUTO") {
        return NextResponse.json({ error: "stage must be SHADOW | ASSIST | AUTO" }, { status: 400 });
      }
      return NextResponse.json(await setDeviceStage(id, stage));
    }

    if (action === "command") {
      const capability = typeof body.capability === "string" ? body.capability : "";
      const steps = Array.isArray(body.steps) ? (body.steps as Array<{ op: string }>) : [];
      if (!capability || steps.length === 0) {
        return NextResponse.json({ error: "capability and steps are required" }, { status: 400 });
      }
      return NextResponse.json(
        await enqueueDeviceCommand({
          deviceId: id,
          companyId: typeof body.companyId === "string" ? body.companyId : undefined,
          capability,
          steps: steps as never,
          taskId: typeof body.taskId === "string" ? body.taskId : undefined,
          approvalId: typeof body.approvalId === "string" ? body.approvalId : undefined,
          idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
        }),
        { status: 201 },
      );
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
