// agent/orchestrator.ts
// 오케스트레이터의 책임:
// 1. Claude로 태스크를 SubTask[]로 분해 (schema-constrained JSON)
// 2. 각 SubTask를 SubAgent에 위임 (컨텍스트 격리)
// 3. 결과를 수집해 최종 답변 합성

import { SubAgent }          from "./subagent.js";
import type { SubTask, SubTaskResult } from "./subagent.js";
import type { EventStream }  from "./events.js";
import { callAgentModel, collectText } from "../llm/agentModel.js";

// ─────────────────────────────────────────────
// 태스크 복잡도 판단: 서브에이전트 분기 여부 결정
// ─────────────────────────────────────────────
const DECOMPOSE_TRIGGER_WORDS = [
  "그리고", "다음으로", "또한", "각각", "모든", "비교", "분석 후",
  "and then", "for each", "compare", "analyze and", "multiple",
];

export function needsOrchestration(task: string): boolean {
  const lower = task.toLowerCase();
  const hasMultipleParts = DECOMPOSE_TRIGGER_WORDS.some((w) => lower.includes(w));
  const isLong = task.length > 300;
  return hasMultipleParts || isLong;
}

// ─────────────────────────────────────────────
// 태스크 분해: Claude에게 SubTask[] JSON 생성 요청
// ─────────────────────────────────────────────
const DECOMPOSE_SYSTEM = `You are a task decomposition expert.
Given a complex task, break it into 2-5 independent subtasks.
Each subtask must have clear inputs and outputs.
Respond ONLY with valid JSON matching the schema — no explanation, no markdown.`;

const DECOMPOSE_SCHEMA = `{
  "subtasks": [
    {
      "id": "subtask_001",
      "description": "구체적인 작업 설명 (무엇을 하고 무엇을 반환할지)",
      "outputSchema": "반환 형식 설명 (예: JSON with fields: title, summary, score)",
      "dependsOn": []   // 이 태스크 실행 전에 완료돼야 할 subtask id 목록
    }
  ]
}`;

interface DecomposeResult {
  subtasks: Array<{
    id:          string;
    description: string;
    outputSchema: string;
    dependsOn:   string[];
  }>;
}

export async function decomposeTasks(task: string): Promise<SubTask[]> {
  const response = await callAgentModel({
    system: DECOMPOSE_SYSTEM,
    messages: [{
      role:    "user",
      content: `Task to decompose:\n\n${task}\n\nOutput schema:\n${DECOMPOSE_SCHEMA}`,
    }],
    maxTokens: 1024,
    temperature: 0,
  });

  const text = collectText(response);

  // JSON 파싱: 마크다운 펜스 제거 후 파싱
  const cleaned = text.replace(/```json|```/g, "").trim();
  const parsed  = JSON.parse(cleaned) as DecomposeResult;

  return parsed.subtasks.map((s) => ({
    id:           s.id,
    description:  s.description,
    outputSchema: s.outputSchema,
    dependsOn:    s.dependsOn,
  }));
}

// ─────────────────────────────────────────────
// 실행 스케줄러: dependsOn 기반 의존성 해소
// dependsOn이 없는 태스크는 병렬 실행
// dependsOn이 있는 태스크는 선행 태스크 완료 후 실행
// ─────────────────────────────────────────────
export async function executeSubTasks(
  subTasks: SubTask[],
  runId:    string,
  stream:   EventStream,
  onProgress?: (msg: string) => void,
): Promise<SubTaskResult[]> {
  const results      = new Map<string, SubTaskResult>();
  const remaining    = [...subTasks];
  const MAX_PARALLEL = 3; // 동시 실행 상한 (Docker 리소스 보호)

  while (remaining.length > 0) {
    // 실행 가능한 태스크: dependsOn이 모두 완료된 것
    const ready = remaining.filter((t) => {
      const deps = (t as SubTask & { dependsOn?: string[] }).dependsOn ?? [];
      return deps.every((dep) => results.has(dep));
    });

    if (ready.length === 0) {
      throw new Error("Circular dependency or unresolvable dependencies in subtasks");
    }

    // 병렬 실행 (상한 적용)
    const batch = ready.slice(0, MAX_PARALLEL);
    onProgress?.(`[Orchestrator] Running ${batch.map((t) => t.id).join(", ")} in parallel`);

    // 이전 결과 중 각 태스크에 필요한 컨텍스트만 주입 (전체 공유 아님)
    const batchWithContext: SubTask[] = batch.map((t) => {
      const deps = (t as SubTask & { dependsOn?: string[] }).dependsOn ?? [];
      const relevantResults = deps
        .map((dep) => results.get(dep))
        .filter(Boolean) as SubTaskResult[];

      const context = relevantResults.length > 0
        ? relevantResults
            .map((r) => `[${r.id}] ${r.output}`)
            .join("\n\n")
        : undefined;

      return { ...t, context };
    });

    // 병렬 실행 후 결과 수집
    const batchResults = await Promise.all(
      batchWithContext.map(async (subTask) => {
        stream.append({
          type:    "agent_thought",
          content: `[Orchestrator] Starting subtask ${subTask.id}: ${subTask.description}`,
        });

        const agent  = new SubAgent(subTask, runId);
        const result = await agent.run();

        stream.append({
          type:    "agent_thought",
          content: `[Orchestrator] Subtask ${subTask.id} ${result.success ? "done" : "failed"} (${result.iterations} iters): ${result.output.slice(0, 200)}`,
        });

        onProgress?.(`[${subTask.id}] ${result.success ? "✓" : "✗"} iterations=${result.iterations}`);
        return result;
      })
    );

    for (const r of batchResults) {
      results.set(r.id, r);
      remaining.splice(remaining.findIndex((t) => t.id === r.id), 1);
    }
  }

  return [...results.values()];
}

// ─────────────────────────────────────────────
// 최종 합성: 모든 서브태스크 결과를 통합 답변으로
// ─────────────────────────────────────────────
const SYNTHESIZE_SYSTEM = `You are a result synthesizer.
Given results from multiple subtasks, produce a coherent final answer for the user.
Be concise and focus on what the user originally asked for.`;

export async function synthesizeResults(
  originalTask:    string,
  subTaskResults:  SubTaskResult[],
): Promise<string> {
  const resultsText = subTaskResults
    .map((r) => `## ${r.id} (${r.success ? "success" : "failed"})\n${r.output}`)
    .join("\n\n");

  const response = await callAgentModel({
    system: SYNTHESIZE_SYSTEM,
    messages: [{
      role:    "user",
      content: `Original task:\n${originalTask}\n\nSubtask results:\n${resultsText}\n\nSynthesize a final answer.`,
    }],
    maxTokens: 2048,
  });

  return collectText(response);
}

// ─────────────────────────────────────────────
// 오케스트레이터 진입점
// loop.ts가 복잡도 판단 후 이 함수를 호출한다
// ─────────────────────────────────────────────
export async function orchestrate(
  task:   string,
  runId:  string,
  stream: EventStream,
  onProgress?: (msg: string) => void,
): Promise<string> {
  // 1. 태스크 분해
  stream.append({
    type:    "agent_thought",
    content: "[Orchestrator] Decomposing task into subtasks...",
  });

  let subTasks: SubTask[];
  try {
    subTasks = await decomposeTasks(task);
  } catch (err) {
    throw new Error(`Task decomposition failed: ${err}`);
  }

  stream.append({
    type:    "agent_thought",
    content: `[Orchestrator] ${subTasks.length} subtasks: ${subTasks.map((t) => t.id).join(", ")}`,
  });
  onProgress?.(`[Orchestrator] Decomposed into ${subTasks.length} subtasks`);

  // 2. 서브태스크 실행
  const results = await executeSubTasks(subTasks, runId, stream, onProgress);

  const failedCount = results.filter((r) => !r.success).length;
  if (failedCount > 0) {
    stream.append({
      type:    "agent_thought",
      content: `[Orchestrator] Warning: ${failedCount}/${results.length} subtasks failed`,
    });
  }

  // 3. 결과 합성
  stream.append({
    type:    "agent_thought",
    content: "[Orchestrator] Synthesizing final result...",
  });

  return await synthesizeResults(task, results);
}
