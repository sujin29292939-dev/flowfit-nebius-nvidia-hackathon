import { NextResponse } from "next/server";

import { deleteOperationChatSession, renameOperationChatSession } from "@/services/operationChatFileStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    sessionId: string;
  };
};

export async function PATCH(request: Request, { params }: RouteContext) {
  const body = (await request.json().catch(() => null)) as { title?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title : "";
  const session = await renameOperationChatSession(params.sessionId, title);

  if (!session) {
    return NextResponse.json({ error: "session not found or title is empty" }, { status: 404 });
  }

  return NextResponse.json({ session });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const deleted = await deleteOperationChatSession(params.sessionId);

  if (!deleted) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
