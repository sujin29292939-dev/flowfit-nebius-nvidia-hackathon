import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages.js";
import type { ToolInput } from "../tools/index.js";
import { getFlowFitAiModel, getFlowFitAiProvider, type FlowFitAiProvider } from "./modelConfig.js";
import {
  callGeminiGenerateContent,
  extractGeminiText,
  extractGeminiToolCalls,
  toGeminiContents,
} from "./gemini.js";

type AgentTextBlock = { type: "text"; text: string };
type AgentToolUseBlock = { type: "tool_use"; id: string; name: string; input: ToolInput };

export type AgentModelContentBlock = AgentTextBlock | AgentToolUseBlock;

export interface AgentModelResponse {
  provider: FlowFitAiProvider;
  model: string;
  content: AgentModelContentBlock[];
  stop_reason?: string | null;
}

interface CallAgentModelInput {
  system: string;
  messages: MessageParam[];
  tools?: Tool[];
  maxTokens: number;
  temperature?: number;
  cacheSystem?: boolean;
}

interface GroqToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface GroqChatBody {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: GroqToolCall[];
    };
  }>;
  error?: {
    message?: string;
  };
}

type GroqMessage =
  | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: GroqToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export async function callAgentModel(input: CallAgentModelInput): Promise<AgentModelResponse> {
  const provider = getFlowFitAiProvider();
  const model = getFlowFitAiModel(provider);

  if (provider === "groq") {
    return callGroqAgentModel(input, model);
  }

  if (provider === "gemini") {
    return callGeminiAgentModel(input, model);
  }

  if (provider === "nebius") {
    return callNebiusAgentModel(input, model);
  }

  return callAnthropicAgentModel(input, model);
}

export function collectText(response: AgentModelResponse): string {
  return response.content
    .filter((block): block is AgentTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function callAnthropicAgentModel(input: CallAgentModelInput, model: string): Promise<AgentModelResponse> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: input.maxTokens,
    ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
    system: input.cacheSystem
      ? [{ type: "text", text: input.system, cache_control: { type: "ephemeral" as const } }]
      : input.system,
    ...(input.tools?.length ? { tools: withToolCache(input.tools) } : {}),
    messages: input.messages,
  });

  const content: AgentModelContentBlock[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    }
    if (block.type === "tool_use") {
      content.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input as ToolInput,
      });
    }
  }

  return {
    provider: "anthropic",
    model,
    content,
    stop_reason: response.stop_reason,
  };
}

async function callGroqAgentModel(input: CallAgentModelInput, model: string): Promise<AgentModelResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
      max_completion_tokens: input.maxTokens,
      messages: [
        { role: "system", content: input.system },
        ...toGroqMessages(input.messages),
      ],
      ...(input.tools?.length
        ? {
            tools: input.tools.map(toGroqTool),
            tool_choice: "auto",
          }
        : {}),
    }),
  });

  const body = await response.json().catch(() => null) as GroqChatBody | null;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Groq agent request failed: ${response.status}`);
  }

  const choice = body?.choices?.[0];
  const message = choice?.message;
  if (!message) {
    throw new Error("Groq agent returned an empty response");
  }

  const content: AgentModelContentBlock[] = [];
  const text = message.content?.trim();
  if (text) {
    content.push({ type: "text", text });
  }

  for (const toolCall of message.tool_calls ?? []) {
    const name = toolCall.function?.name;
    if (!name) continue;
    content.push({
      type: "tool_use",
      id: toolCall.id ?? `tool_${Date.now()}_${content.length}`,
      name,
      input: parseToolArguments(toolCall.function?.arguments),
    });
  }

  return {
    provider: "groq",
    model,
    content,
    stop_reason: choice?.finish_reason === "stop" ? "end_turn" : choice?.finish_reason,
  };
}

async function callNebiusAgentModel(input: CallAgentModelInput, model: string): Promise<AgentModelResponse> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new Error("NEBIUS_API_KEY is required");
  const baseUrl = (process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
      max_tokens: input.maxTokens,
      messages: [{ role: "system", content: input.system }, ...toGroqMessages(input.messages)],
      ...(input.tools?.length ? { tools: input.tools.map(toGroqTool), tool_choice: "auto" } : {}),
    }),
  });
  const body = await response.json().catch(() => null) as GroqChatBody | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `Nebius agent request failed: ${response.status}`);
  const choice = body?.choices?.[0];
  const message = choice?.message;
  if (!message) throw new Error("Nebius agent returned an empty response");
  const content: AgentModelContentBlock[] = [];
  const text = message.content?.trim();
  if (text) content.push({ type: "text", text });
  for (const toolCall of message.tool_calls ?? []) {
    const name = toolCall.function?.name;
    if (!name) continue;
    content.push({ type: "tool_use", id: toolCall.id ?? `tool_${Date.now()}_${content.length}`, name, input: parseToolArguments(toolCall.function?.arguments) });
  }
  return { provider: "nebius", model, content, stop_reason: choice?.finish_reason === "stop" ? "end_turn" : choice?.finish_reason };
}

async function callGeminiAgentModel(input: CallAgentModelInput, model: string): Promise<AgentModelResponse> {
  const body = await callGeminiGenerateContent({
    model,
    system: input.system,
    tools: input.tools,
    temperature: input.temperature,
    maxOutputTokens: input.maxTokens,
    contents: toGeminiContents(input.messages),
  });

  const content: AgentModelContentBlock[] = [];
  const text = extractGeminiText(body);
  if (text) {
    content.push({ type: "text", text });
  }

  for (const toolCall of extractGeminiToolCalls(body)) {
    content.push({
      type: "tool_use",
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
    });
  }

  return {
    provider: "gemini",
    model,
    content,
    stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
  };
}

function withToolCache(tools: Tool[]): Tool[] {
  return tools.map((tool, index) =>
    index === tools.length - 1
      ? { ...tool, cache_control: { type: "ephemeral" as const } }
      : tool,
  ) as Tool[];
}

function toGroqTool(tool: Tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.input_schema,
    },
  };
}

function toGroqMessages(messages: MessageParam[]): GroqMessage[] {
  const result: GroqMessage[] = [];

  for (const message of messages) {
    if (typeof message.content === "string") {
      result.push({ role: message.role, content: message.content });
      continue;
    }

    if (!Array.isArray(message.content)) {
      continue;
    }

    const textParts: string[] = [];
    const toolCalls: GroqToolCall[] = [];

    for (const block of message.content as unknown as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      }

      if (block.type === "tool_use" && typeof block.name === "string" && typeof block.id === "string") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      }

      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        result.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: stringifyToolResult(block.content),
        });
      }
    }

    if (toolCalls.length > 0) {
      result.push({
        role: "assistant",
        content: textParts.join("\n") || null,
        tool_calls: toolCalls,
      });
      continue;
    }

    if (textParts.length > 0) {
      result.push({ role: message.role, content: textParts.join("\n") });
    }
  }

  return result;
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

function parseToolArguments(raw: string | undefined): ToolInput {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? parsed as ToolInput
    : {};
}
