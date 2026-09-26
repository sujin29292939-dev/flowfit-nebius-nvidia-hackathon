// understanding/engine.ts
// Converts raw intake text into a normalized business task.

import { standardizeBusinessFields } from "./dateStandardizer.js";
import { heuristicUnderstand } from "./heuristics.js";
import { llmUnderstand } from "./llm.js";
import { TaskUnderstandingSchema } from "./schema.js";
import type { TaskUnderstandingResult, UnderstandingInput } from "./types.js";

export async function understandBusinessTask(input: UnderstandingInput): Promise<TaskUnderstandingResult> {
  if (!input.rawText.trim()) {
    return {
      taskType: "unknown",
      title: "내용 없는 입력",
      summary: "분류할 원문이 없습니다.",
      fields: standardizeBusinessFields({}, "", input.receivedAt),
      missingFields: ["원문"],
      confidence: 0,
      riskLevel: "uncertain",
      recommendedAction: "원본 입력 확인",
      evidence: [],
      needsHumanReview: true,
      engine: "heuristic",
    };
  }

  try {
    const result = await llmUnderstand(input);
    return normalizeResult(result, "llm", input);
  } catch {
    return normalizeResult(heuristicUnderstand(input), "heuristic", input);
  }
}

function normalizeResult(
  result: TaskUnderstandingResult,
  engine: TaskUnderstandingResult["engine"],
  input: UnderstandingInput,
) {
  const parsed = TaskUnderstandingSchema.parse({
    ...result,
    fields: standardizeBusinessFields(result.fields, input.rawText, input.receivedAt),
    engine,
  });
  return {
    ...parsed,
    confidence: Number(parsed.confidence.toFixed(2)),
    engine,
  };
}
