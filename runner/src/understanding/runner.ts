// understanding/runner.ts
// intake id를 받아 이해 엔진을 실행하고 task로 저장한다.

import { understandBusinessTask } from "./engine.js";
import { scheduleContextMatch } from "../context/runner.js";
import {
  getIntakeForUnderstanding,
  listPendingUnderstandingIntakes,
  markIntakeUnderstandingFailed,
  saveUnderstandingAsTask,
} from "./taskStore.js";
import type { UnderstandingInput } from "./types.js";

export async function understandAndStoreIntake(intakeId: string) {
  const intake = await getIntakeForUnderstanding(intakeId);
  if (!intake) throw new Error(`Intake not found: ${intakeId}`);

  try {
    const understanding = await understandBusinessTask(intake);
    const task = await saveUnderstandingAsTask(intake, understanding);
    const taskId = (task as Record<string, unknown>).id;
    if (typeof taskId === "string") scheduleContextMatch(taskId);
    return { intake, understanding, task };
  } catch (error) {
    await markIntakeUnderstandingFailed(intakeId, String(error)).catch(() => {});
    throw error;
  }
}

export async function understandAndStoreRaw(input: UnderstandingInput) {
  const understanding = await understandBusinessTask(input);
  return { understanding };
}

export async function understandPendingIntakes(input: { companyId?: string; limit?: number }) {
  const intakes = await listPendingUnderstandingIntakes(input);
  const results: Array<{ intakeId: string; ok: boolean; taskId?: unknown; error?: string }> = [];

  for (const row of intakes) {
    const intakeId = String(row.id);
    try {
      const result = await understandAndStoreIntake(intakeId);
      results.push({ intakeId, ok: true, taskId: (result.task as Record<string, unknown>).id });
    } catch (error) {
      results.push({ intakeId, ok: false, error: String(error) });
    }
  }

  return { count: results.length, results };
}

export function shouldAutoUnderstandIntakes() {
  return process.env.AUTO_UNDERSTAND_INTAKES !== "false";
}

export function scheduleUnderstanding(intakeId: string) {
  if (!shouldAutoUnderstandIntakes()) return;
  setTimeout(() => {
    understandAndStoreIntake(intakeId).catch((error) => {
      console.error(`[Understanding] failed for ${intakeId}: ${String(error)}`);
    });
  }, 0);
}
