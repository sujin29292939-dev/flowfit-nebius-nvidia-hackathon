// agent/loop.ts
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { EventStream }       from "./events.js";
import { buildMessages, shouldCompact, getCompactTargets } from "./context.js";
import { getToolDefinitionsForBrief, ToolExecutor, type ToolInput }  from "../tools/index.js";
import { DockerSandbox }     from "../sandbox/docker.js";
import { SYSTEM_PROMPT }     from "../llm/prompts.js";
import { callAgentModel }    from "../llm/agentModel.js";
import { broadcaster }       from "../runner/sse.js";
import * as db               from "../db/client.js";
import { needsOrchestration, orchestrate } from "./orchestrator.js";
import type { ExecutionBrief } from "./executionBrief.js";
import fs                    from "node:fs/promises";
import path                  from "node:path";

const MAX_ITER      = 100;

export interface RunOptions {
  runId: string;
  task: string;
  executionBrief?: ExecutionBrief;
}

export async function runAgent(opts: RunOptions): Promise<string> {
  const { runId, task, executionBrief } = opts;
  const sandbox = new DockerSandbox(runId);
  const stream  = new EventStream(async (event, seq) => {
    // 이벤트 발생 즉시 두 곳으로 동시 전달
    // 1) SSE: Studio 실시간 수신
    broadcaster.emit(runId, { type: "agent_event", event, seq });
    // 2) DB: 영속화 (비동기, 에러가 루프를 막지 않도록 catch)
    db.appendEvent(runId, seq, event).catch((err) =>
      console.error(`[DB] appendEvent error: ${err}`)
    );
  });

  const executor = new ToolExecutor(sandbox, { runId, executionBrief });

  try {
    await sandbox.start();
    await db.createRun(runId, task);
    broadcaster.emit(runId, { type: "run_started", runId });

    // 태스크를 이벤트 스트림에 주입
    stream.append({ type: "user_message", content: buildInitialTask(task, executionBrief) });

    // ── 복잡도 판단: 멀티 에이전트 vs 단일 에이전트 ──────────
    if (needsOrchestration(task)) {
      console.log(`[${runId.slice(0,8)}] Orchestrator mode`);
      const result = await orchestrate(task, runId, stream, (msg) => {
        console.log(`[${runId.slice(0,8)}] ${msg}`);
      });
      await db.completeRun(runId, result);
      broadcaster.emit(runId, { type: "run_done", runId, result });
      return result;
    }

    for (let iter = 0; iter < MAX_ITER; iter++) {
      // compaction 필요 시 실행
      if (shouldCompact(stream)) await runCompaction(stream, sandbox);

      // Claude API 호출
      const messages  = buildMessages(stream);
      const response  = await callAgent(messages, executionBrief);

      const textBlock = response.content.find((b) => b.type === "text") as
        { type: "text"; text: string } | undefined;
      const toolBlock = response.content.find((b) => b.type === "tool_use") as
        | { type: "tool_use"; id: string; name: string; input: ToolInput }
        | undefined;

      if (textBlock?.text) {
        stream.append({ type: "agent_thought", content: textBlock.text });
      }

      if (!toolBlock) {
        // tool 없이 end_turn → 완료
        if (response.stop_reason === "end_turn") {
          const result = textBlock?.text ?? "Task completed.";
          await db.completeRun(runId, result);
          broadcaster.emit(runId, { type: "run_done", runId, result });
          return result;
        }
        continue;
      }

      // tool_call 이벤트 기록
      stream.append({
        type:      "tool_call",
        toolName:  toolBlock.name,
        toolUseId: toolBlock.id,
        input:     toolBlock.input,
      });

      // task_done 처리
      if (toolBlock.name === "task_done") {
        const result = (toolBlock.input as { result: string }).result;
        stream.append({ type: "task_complete", result });
        await db.completeRun(runId, result);
        broadcaster.emit(runId, { type: "run_done", runId, result });
        return result;
      }

      // 툴 실행
      const output = await executor.execute(toolBlock.name, toolBlock.input);

      // 파일 생성 추적
      if (toolBlock.name === "write_file") {
        const fp = toolBlock.input.path as string;
        db.recordFile(runId, fp).catch(() => {});
      }
      if (output.offloadedPath) {
        db.recordFile(runId, output.offloadedPath).catch(() => {});
      }

      // tool_result 이벤트 기록
      stream.append({
        type:           "tool_result",
        toolUseId:      toolBlock.id,
        content:        output.content,
        offloadedPath:  output.offloadedPath,
        isError:        output.isError,
      });

      console.log(`[${runId.slice(0,8)}] iter=${iter+1} tool=${toolBlock.name} ok=${!output.isError}`);
    }

    const msg = "Max iterations reached.";
    await db.failRun(runId, msg);
    broadcaster.emit(runId, { type: "run_error", runId, error: msg });
    return msg;

  } catch (err) {
    const msg = String(err);
    await db.failRun(runId, msg).catch(() => {});
    broadcaster.emit(runId, { type: "run_error", runId, error: msg });
    throw err;
  } finally {
    await sandbox.stop();
    broadcaster.close(runId);
  }
}

// ─── helpers ──────────────────────────────────────────────

async function callAgent(messages: MessageParam[], executionBrief?: ExecutionBrief) {
  return callAgentModel({
    system: SYSTEM_PROMPT,
    tools: getToolDefinitionsForBrief(executionBrief),
    messages,
    maxTokens: 4096,
    cacheSystem: true,
    /*
      cache_control: { type: "ephemeral" },   // 정적 프롬프트 KV 캐시
    }],
    tools: TOOL_DEFINITIONS.map((t, i) =>
      i === TOOL_DEFINITIONS.length - 1
        ? { ...t, cache_control: { type: "ephemeral" as const } }
        : t
    ),
    messages,
    */
  });
}

function buildInitialTask(task: string, executionBrief?: ExecutionBrief): string {
  if (!executionBrief) return task;
  return [
    task,
    "",
    "## ExecutionBrief",
    JSON.stringify(executionBrief, null, 2),
    "",
    "Follow this ExecutionBrief exactly. If an action is not allowed, stop and explain what approval or missing policy is needed.",
  ].join("\n");
}

async function runCompaction(stream: EventStream, sandbox: DockerSandbox) {
  const targets = getCompactTargets(stream);
  for (const id of targets) {
    const evt = stream.getAll().find((e) => e.id === id);
    if (evt?.type !== "tool_result") continue;
    const content = (evt as { content?: string }).content;
    if (!content) continue;
    const fname = `compacted_${id}.txt`;
    await fs.writeFile(path.join(sandbox.workspacePath, fname), content, "utf-8");
    stream.compactToolResult(id, `/workspace/${fname}`);
  }
}
