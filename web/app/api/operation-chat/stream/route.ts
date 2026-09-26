import { buildAssistantContent } from "@/services/operationChatAi";
import {
  appendOperationChatMessage,
  readOperationChatSessions,
  replaceLastAssistantMessage,
  type OperationChatAttachment,
  type OperationChatSession,
} from "@/services/operationChatFileStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

type StreamBody = {
  message?: unknown;
  sessionId?: unknown;
  regenerate?: unknown;
  attachments?: unknown;
  locale?: unknown;
};

function encodeSse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function chunkText(value: string) {
  const chunks: string[] = [];
  let index = 0;

  while (index < value.length) {
    const nextBreak = value.indexOf("\n", index);

    if (nextBreak >= 0 && nextBreak - index <= 28) {
      chunks.push(value.slice(index, nextBreak + 1));
      index = nextBreak + 1;
      continue;
    }

    const size = value.charCodeAt(index) > 127 ? 7 : 11;
    chunks.push(value.slice(index, index + size));
    index += size;
  }

  return chunks.length ? chunks : ["응답 없음"];
}

function findLastUserMessage(session: OperationChatSession | undefined) {
  return [...(session?.messages ?? [])].reverse().find((message) => message.role === "user") ?? null;
}

function normalizeAttachments(value: unknown): OperationChatAttachment[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 4)
    .map((item, index) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const name = typeof record.name === "string" ? record.name.trim().slice(0, 120) : `attachment-${index + 1}`;
      const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim().slice(0, 120) : "application/octet-stream";
      const dataBase64 = typeof record.dataBase64 === "string" ? record.dataBase64.trim() : "";
      const size = typeof record.size === "number" && Number.isFinite(record.size) ? Math.max(0, Math.floor(record.size)) : 0;
      const id = typeof record.id === "string" ? record.id.trim().slice(0, 80) : `attachment-${Date.now()}-${index}`;

      if (!dataBase64 || size > 5 * 1024 * 1024) return null;

      return {
        id,
        name,
        mimeType,
        size,
        dataBase64,
      };
    })
    .filter((item): item is OperationChatAttachment => Boolean(item));
}

function buildPromptWithAttachments(prompt: string, attachments: OperationChatAttachment[]) {
  if (!attachments.length) return prompt;

  const attachmentSummary = attachments
    .map((attachment, index) => {
      const kind = attachment.mimeType.startsWith("image/") ? "image" : "file";
      return [
        `${index + 1}. ${attachment.name}`,
        `   kind: ${kind}`,
        `   mime: ${attachment.mimeType}`,
        `   size: ${attachment.size}`,
        `   base64: ${attachment.dataBase64.slice(0, 160)}${attachment.dataBase64.length > 160 ? "...[truncated]" : ""}`,
      ].join("\n");
    })
    .join("\n");

  return [
    prompt,
    "",
    "[Attached multimodal payloads received as base64. Use the user's message, file names, mime types, and available metadata. If binary content must be inspected directly, say what extraction is needed.]",
    attachmentSummary,
  ].join("\n");
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getThinkingText(locale: "ko" | "en") {
  if (locale === "en") {
    return {
      intent: "Checking the request intent.\n",
      route: "Routing as either general chat or an order/quote request.\n",
      runner: "Connecting the Runner and AI response.\n",
    };
  }

  return {
    intent: "요청 의도를 확인하고 있습니다.\n",
    route: "일반 대화인지 발주/견적 요청인지 분기합니다.\n",
    runner: "Runner와 AI 응답을 연결하고 있습니다.\n",
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as StreamBody | null;
  const regenerate = body?.regenerate === true;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;
  const locale = body?.locale === "en" ? "en" : "ko";
  const thinking = getThinkingText(locale);
  const rawMessage = typeof body?.message === "string" ? body.message.trim() : "";
  const message = rawMessage.slice(0, 4000);
  const requestAttachments = normalizeAttachments(body?.attachments);

  if (!regenerate && !message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  if (rawMessage.length > 32_000) {
    return Response.json({ error: "message is too long" }, { status: 413 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encodeSse("thinking_delta", { text: thinking.intent }));
        await wait(80);
        controller.enqueue(encodeSse("thinking_delta", { text: thinking.route }));

        const sessions = sessionId ? await readOperationChatSessions() : [];
        const targetSession = sessionId ? sessions.find((session) => session.id === sessionId) : undefined;
        const targetUserMessage = regenerate ? findLastUserMessage(targetSession) : null;
        const prompt = regenerate ? targetUserMessage?.content.trim() ?? "" : message;
        const attachments = regenerate ? targetUserMessage?.attachments ?? [] : requestAttachments;
        const history =
          regenerate && targetSession && targetUserMessage
            ? targetSession.messages.slice(
                0,
                Math.max(
                  0,
                  targetSession.messages.findIndex((item) => item.id === targetUserMessage.id),
                ),
              )
            : targetSession?.messages;

        if (!prompt) {
          throw new Error("regenerate target user message not found");
        }

        await wait(80);
        controller.enqueue(encodeSse("thinking_delta", { text: thinking.runner }));

        const assistantContent = await buildAssistantContent(buildPromptWithAttachments(prompt, attachments), {
          isFirstResponse: !sessionId && !regenerate,
          history,
        });
        const safeContent = assistantContent.trim() || "응답 없음";
        const session =
          regenerate && sessionId
            ? await replaceLastAssistantMessage({ sessionId, assistantContent: safeContent })
            : await appendOperationChatMessage({
                sessionId,
                message: prompt,
                attachments,
                assistantContent: safeContent,
              });

        if (!session) {
          throw new Error("chat session could not be saved");
        }

        controller.enqueue(encodeSse("session_meta", { sessionId: session.id, title: session.title }));

        for (const chunk of chunkText(safeContent)) {
          controller.enqueue(encodeSse("delta", { text: chunk }));
          await wait(12);
        }

        controller.enqueue(encodeSse("session", { session }));
        controller.enqueue(encodeSse("done", { ok: true }));
      } catch (error) {
        controller.enqueue(encodeSse("error", { message: getErrorMessage(error) }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
