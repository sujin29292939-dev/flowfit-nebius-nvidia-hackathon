// agent/subagent.ts
// 핵심 원칙: 서브에이전트는 필요한 지시만 받고, 결과만 반환한다.
// 오케스트레이터의 전체 이벤트 스트림을 공유하지 않는다.
// → KV 캐시 오염 방지, 무관 정보로 모델 혼란 방지

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { DockerSandbox }     from "../sandbox/docker.js";
import { getToolDefinitionsForBrief, ToolExecutor, type ToolInput } from "../tools/index.js";
import { SYSTEM_PROMPT }     from "../llm/prompts.js";
import { callAgentModel }    from "../llm/agentModel.js";

const MAX_ITER = 40; // 서브에이전트는 오케스트레이터보다 짧게

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────

// 오케스트레이터가 서브에이전트에게 전달하는 지시
export interface SubTask {
  id:          string;          // "subtask_001"
  description: string;          // 수행할 작업 설명
  outputSchema: string;         // 반환해야 할 결과 형식 (JSON 스키마 설명)
  context?:    string;          // 이전 서브태스크 결과 중 이 태스크에 필요한 것만
  sharedFiles?: string[];       // 오케스트레이터 workspace에서 공유할 파일 경로
}

// 서브에이전트가 반환하는 결과
export interface SubTaskResult {
  id:        string;
  success:   boolean;
  output:    string;            // outputSchema에 맞는 결과 (가능하면 JSON)
  files:     string[];          // 생성한 파일 목록
  error?:    string;
  iterations: number;
}

// ─────────────────────────────────────────────
// SubAgent
// ─────────────────────────────────────────────
export class SubAgent {
  private sandbox:  DockerSandbox;
  private executor: ToolExecutor;
  // 서브에이전트 자체 메시지 이력 (오케스트레이터와 완전 분리)
  private messages: MessageParam[] = [];
  private iterCount = 0;

  constructor(private subTask: SubTask, private parentRunId: string) {
    this.sandbox  = new DockerSandbox(`${parentRunId}-sub-${subTask.id}`);
    this.executor = new ToolExecutor(this.sandbox, { runId: `${parentRunId}:${subTask.id}` });
  }

  async run(): Promise<SubTaskResult> {
    await this.sandbox.start();

    try {
      // 초기 메시지: 지시 + 스키마만 포함 (전체 궤적 없음)
      const systemContext = this.buildSubAgentPrompt();
      this.messages.push({
        role:    "user",
        content: systemContext,
      });

      for (let i = 0; i < MAX_ITER; i++) {
        this.iterCount++;
        const response = await this.callAgent();

        const textBlock = response.content.find((b) => b.type === "text") as
          | { type: "text"; text: string } | undefined;
        const toolBlock = response.content.find((b) => b.type === "tool_use") as
          | { type: "tool_use"; id: string; name: string; input: ToolInput } | undefined;

        // assistant 턴 기록
        this.messages.push({ role: "assistant", content: response.content as MessageParam["content"] });

        if (!toolBlock) {
          // 툴 없이 종료 → 텍스트를 결과로 반환
          return this.makeResult(true, textBlock?.text ?? "", []);
        }

        // task_done 처리
        if (toolBlock.name === "task_done") {
          const input = toolBlock.input as { result: string; output_files?: string[] };
          const files = await this.sandbox.listWorkspaceFiles();
          return this.makeResult(true, input.result, input.output_files ?? files);
        }

        // 툴 실행
        const output = await this.executor.execute(toolBlock.name, toolBlock.input);

        // tool_result를 다음 user 턴에 추가
        this.messages.push({
          role: "user",
          content: [{
            type:        "tool_result",
            tool_use_id: toolBlock.id,
            content:     output.content,
            is_error:    output.isError,
          }],
        });
      }

      return this.makeResult(false, "", [], "Max iterations reached");
    } catch (err) {
      return this.makeResult(false, "", [], String(err));
    } finally {
      await this.sandbox.stop();
    }
  }

  // 서브에이전트 전용 시스템 프롬프트
  // 오케스트레이터 컨텍스트와 완전히 분리된 독립 지시문
  private buildSubAgentPrompt(): string {
    const lines: string[] = [
      `You are a focused sub-agent. Complete ONE specific task and return results in the required format.`,
      ``,
      `## Your Task`,
      this.subTask.description,
      ``,
      `## Required Output Format`,
      this.subTask.outputSchema,
      ``,
      `When done, call task_done with your result in the required format.`,
    ];

    if (this.subTask.context) {
      lines.splice(5, 0, `## Context from Previous Steps`, this.subTask.context, ``);
    }

    if (this.subTask.sharedFiles?.length) {
      lines.push(`## Available Files`, ...this.subTask.sharedFiles.map((f) => `- ${f}`));
    }

    return lines.join("\n");
  }

  private async callAgent() {
    const subTaskTools = (this.subTask as { allowedTools?: string[] }).allowedTools;
    return callAgentModel({
      system: SYSTEM_PROMPT,
      tools: getToolDefinitionsForBrief({ allowedTools: subTaskTools }),
      messages: this.messages,
      maxTokens: 2048,
      cacheSystem: true,
      /*
        type:          "text",
        text:          SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" }, // 서브에이전트도 동일 시스템 프롬프트 → 캐시 공유
      }],
      tools: TOOL_DEFINITIONS.map((t, i) =>
        i === TOOL_DEFINITIONS.length - 1
          ? { ...t, cache_control: { type: "ephemeral" as const } }
          : t
      ),
      messages: this.messages,
      */
    });
  }

  private makeResult(
    success: boolean,
    output:  string,
    files:   string[],
    error?:  string
  ): SubTaskResult {
    return {
      id:         this.subTask.id,
      success,
      output,
      files,
      error,
      iterations: this.iterCount,
    };
  }

  async listWorkspaceFiles(): Promise<string[]> {
    return this.sandbox.listWorkspaceFiles();
  }
}
