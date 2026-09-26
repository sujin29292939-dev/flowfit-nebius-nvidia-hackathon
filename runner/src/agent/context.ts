// agent/context.ts
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import type { AgentEvent, EventStream, ToolCallEvent, ToolResultEvent } from "./events.js";

const COMPACT_THRESHOLD  = 80_000;
const RECENT_KEEP_RAW    = 3;
const OFFLOAD_MIN_LENGTH = 500; // 이보다 짧은 결과는 compaction 대상 제외

export function buildMessages(stream: EventStream): MessageParam[] {
  const events  = stream.getAll();
  const messages: MessageParam[] = [];
  let i = 0;

  while (i < events.length) {
    const e = events[i];

    if (e.type === "user_message") {
      messages.push({ role: "user", content: e.content }); i++; continue;
    }
    if (e.type === "agent_thought") {
      messages.push({ role: "assistant", content: e.content }); i++; continue;
    }
    if (e.type === "task_complete") {
      messages.push({ role: "assistant", content: `Task complete: ${e.result}` }); i++; continue;
    }
    if (e.type === "tool_call") {
      const call = e as ToolCallEvent;
      messages.push({
        role: "assistant",
        content: [{ type: "tool_use", id: call.toolUseId, name: call.toolName, input: call.input }],
      });
      const next = events[i + 1];
      if (next?.type === "tool_result") {
        const r = next as ToolResultEvent;
        const content = r.offloadedPath
          ? `[Result offloaded → ${r.offloadedPath}]`
          : (r.content ?? "");
        const block: ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: r.toolUseId,
          content,
          is_error: r.isError,
        };
        messages.push({ role: "user", content: [block] });
        i += 2;
      } else { i++; }
      continue;
    }
    i++;
  }
  return messages;
}

export function shouldCompact(stream: EventStream): boolean {
  return stream.getTotalTokenEstimate() > COMPACT_THRESHOLD;
}

export function getCompactTargets(stream: EventStream): string[] {
  const events      = stream.getAll();
  const toolResults = events.filter(
    (e) => e.type === "tool_result" && !e.compact
  ) as ToolResultEvent[];

  if (toolResults.length <= RECENT_KEEP_RAW) return [];

  return toolResults
    .slice(0, toolResults.length - RECENT_KEEP_RAW)
    .filter((e) => (e.content?.length ?? 0) > OFFLOAD_MIN_LENGTH)
    .map((e) => e.id);
}
