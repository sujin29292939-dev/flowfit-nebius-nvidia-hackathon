import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages.js";
import type { ToolInput } from "../tools/index.js";

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiBody = {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: {
          name?: string;
          args?: Record<string, unknown>;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

export type GeminiToolCall = {
  id: string;
  name: string;
  input: ToolInput;
};

export async function callGeminiGenerateContent(input: {
  model: string;
  system?: string;
  contents: GeminiContent[];
  tools?: Tool[];
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: "application/json" | "text/plain";
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: input.contents,
        ...(input.system
          ? { systemInstruction: { parts: [{ text: input.system }] } }
          : {}),
        ...(input.tools?.length
          ? { tools: [{ functionDeclarations: input.tools.map(toGeminiFunctionDeclaration) }] }
          : {}),
        generationConfig: {
          ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
          ...(typeof input.maxOutputTokens === "number" ? { maxOutputTokens: input.maxOutputTokens } : {}),
          ...(input.responseMimeType ? { responseMimeType: input.responseMimeType } : {}),
        },
      }),
    },
  );

  const body = await response.json().catch(() => null) as GeminiBody | null;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Gemini request failed: ${response.status}`);
  }

  return body;
}

export function extractGeminiText(body: GeminiBody | null): string {
  return (body?.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

export function extractGeminiToolCalls(body: GeminiBody | null): GeminiToolCall[] {
  return (body?.candidates?.[0]?.content?.parts ?? [])
    .map((part, index) => {
      const call = part.functionCall;
      if (!call?.name) return null;
      return {
        id: `gemini_tool_${Date.now()}_${index}`,
        name: call.name,
        input: normalizeToolInput(call.args),
      };
    })
    .filter((item): item is GeminiToolCall => !!item);
}

export function toGeminiContents(messages: MessageParam[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  const toolNamesById = new Map<string, string>();

  for (const message of messages) {
    if (typeof message.content === "string") {
      if (message.content.trim()) {
        contents.push({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        });
      }
      continue;
    }

    if (!Array.isArray(message.content)) continue;

    const parts: GeminiPart[] = [];
    for (const block of message.content as unknown as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        parts.push({ text: block.text });
      }

      if (block.type === "tool_use" && typeof block.name === "string") {
        if (typeof block.id === "string") toolNamesById.set(block.id, block.name);
        parts.push({
          functionCall: {
            name: block.name,
            args: normalizeToolInput(block.input),
          },
        });
      }

      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        const name = toolNamesById.get(block.tool_use_id) ?? "tool_result";
        parts.push({
          functionResponse: {
            name,
            response: {
              result: stringifyToolResult(block.content),
              isError: block.is_error === true,
            },
          },
        });
      }
    }

    if (parts.length) {
      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts,
      });
    }
  }

  return contents;
}

export function textToGeminiContents(input: { role: "user" | "assistant"; content: string }[]): GeminiContent[] {
  return input
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
}

function toGeminiFunctionDeclaration(tool: Tool) {
  return {
    name: tool.name,
    description: tool.description ?? "",
    parameters: normalizeJsonSchema(tool.input_schema),
  };
}

function normalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema);
  if (!value || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => key !== "$schema" && key !== "additionalProperties")
      .map(([key, item]) => [key, normalizeJsonSchema(item)]),
  );
}

function normalizeToolInput(value: unknown): ToolInput {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ToolInput
    : {};
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item && "text" in item) {
          return String((item as { text?: unknown }).text ?? "");
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}
