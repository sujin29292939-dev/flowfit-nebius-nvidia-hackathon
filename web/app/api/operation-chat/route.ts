import { NextResponse } from "next/server";

import { buildAssistantContent } from "@/services/operationChatAi";
import { appendOperationChatMessage, readOperationChatSessions } from "@/services/operationChatFileStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sessions = await readOperationChatSessions();
  return NextResponse.json({
    sessions: [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { message?: unknown; sessionId?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  if (message.length > 32_000) {
    return NextResponse.json({ error: "message is too long" }, { status: 413 });
  }

  const sessions = sessionId ? await readOperationChatSessions() : [];
  const targetSession = sessionId ? sessions.find((session) => session.id === sessionId) : undefined;
  const assistantContent = await buildAssistantContent(message.slice(0, 4000), {
    isFirstResponse: !targetSession,
    history: targetSession?.messages,
  });
  const session = await appendOperationChatMessage({
    sessionId,
    message: message.slice(0, 4000),
    assistantContent,
  });

  return NextResponse.json({ session }, { status: 201 });
}
