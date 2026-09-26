// FlowFit Understanding regression/evaluation runner.
//
// Usage:
//   Heuristic only: TASK_UNDERSTANDING_MODE=heuristic npx tsx test/understanding-eval/run.ts
//   With LLM:       npx tsx --env-file=.env test/understanding-eval/run.ts
//   Partial run:    npx tsx test/understanding-eval/run.ts --limit 50
//   Regression:     npx tsx test/understanding-eval/run.ts --mode heuristic --min-intent 0.7 --min-slot 0.45 --max-unsafe 0
//
// Metrics:
//   1) Intent Accuracy      expectedTaskType vs predicted taskType
//   2) Clarification P/R    clarificationRequired vs needsHumanReview
//   3) Slot Recall          expected keySlots extracted
//   4) Unsafe Auto-run Rate clarificationRequired=true but needsHumanReview=false

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { understandBusinessTask } from "../../src/understanding/engine.js";
import { decideRoute } from "../../src/decision/routePolicy.js";
import type { TaskUnderstandingResult } from "../../src/understanding/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface EvalCase {
  id: string;
  splitGroup: string;
  scenarioType: string;
  noiseType: string;
  goldIntent: string;
  expectedTaskType: string | null;
  clarificationRequired: boolean;
  sentence: string;
  expectedAction: string | null;
  keySlots: Record<string, string>;
  notes: string | null;
}

interface CaseResult {
  id: string;
  goldIntent: string;
  expected: string | null;
  predicted: string;
  intentCorrect: boolean | null;
  clarificationRequired: boolean;
  flaggedForReview: boolean;
  unsafeAutoRun: boolean;
  slotHits: number;
  slotTotal: number;
  engine: string;
  error?: string;
  expectedRoute: string | null;
  predictedRoute: string | null;
  routeCorrect: boolean | null;
}

type Thresholds = {
  minIntent?: number;
  minSlot?: number;
  maxUnsafe?: number;
  minRoute?: number;
};

/** 데이터셋 라우트 라벨 정규화: clarify_or_structure는 되묻기 계열로 취급 */
function normalizeExpectedRoute(value: string | null): string | null {
  if (!value) return null;
  if (value === "clarify_or_structure") return "clarification_required";
  return value;
}

const SLOT_FIELD_MAP: Record<string, (r: TaskUnderstandingResult) => string | undefined> = {
  customer: (r) => r.fields.customerName,
  item: (r) => r.fields.itemName,
  qty: (r) => r.fields.quantity !== undefined ? `${r.fields.quantity}${r.fields.unit ?? ""}` : undefined,
  qty_threshold: (r) => r.fields.quantity !== undefined ? `${r.fields.quantity}${r.fields.unit ?? ""}` : undefined,
  due: (r) => r.fields.dueDateText ?? r.fields.dueDate,
  amount: (r) => r.fields.amount !== undefined ? String(r.fields.amount) : undefined,
  depositor: (r) => r.fields.depositorName,
  order_no: (r) => r.fields.orderNumber,
  tracking_no: (r) => r.fields.trackingNumber,
  address: (r) => r.fields.deliveryAddress,
  channel: (r) => r.fields.requestedReplyChannel,
  contact: (r) => r.fields.contactName,
};

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\-_.,/()[\]]+/g, "");
}

function slotMatched(expectedValue: string, result: TaskUnderstandingResult, slotKey: string): boolean {
  const extractor = SLOT_FIELD_MAP[slotKey];
  const extracted = extractor?.(result);
  const expectedNorm = normalize(expectedValue);
  if (extracted && (normalize(extracted).includes(expectedNorm) || expectedNorm.includes(normalize(extracted)))) {
    return true;
  }
  return false;
}

async function runCase(c: EvalCase): Promise<CaseResult> {
  try {
    const result = await understandBusinessTask({
      companyId: "eval",
      sourceType: "manual",
      rawText: c.sentence,
      receivedAt: new Date("2026-07-01T09:00:00+09:00").toISOString(),
    });

    const slotKeys = Object.keys(c.keySlots);
    const slotHits = slotKeys.filter((key) => slotMatched(c.keySlots[key], result, key)).length;

    const expectedRoute = normalizeExpectedRoute(c.expectedAction);
    const predictedRoute = decideRoute(result).route;

    return {
      expectedRoute,
      predictedRoute,
      routeCorrect: expectedRoute === null ? null : predictedRoute === expectedRoute,
      id: c.id,
      goldIntent: c.goldIntent,
      expected: c.expectedTaskType,
      predicted: result.taskType,
      intentCorrect: c.expectedTaskType === null ? null : result.taskType === c.expectedTaskType,
      clarificationRequired: c.clarificationRequired,
      flaggedForReview: result.needsHumanReview,
      unsafeAutoRun: c.clarificationRequired && !result.needsHumanReview,
      slotHits,
      slotTotal: slotKeys.length,
      engine: result.engine,
    };
  } catch (error) {
    return {
      id: c.id,
      goldIntent: c.goldIntent,
      expected: c.expectedTaskType,
      predicted: "ERROR",
      intentCorrect: c.expectedTaskType === null ? null : false,
      clarificationRequired: c.clarificationRequired,
      flaggedForReview: true,
      unsafeAutoRun: false,
      slotHits: 0,
      slotTotal: Object.keys(c.keySlots).length,
      engine: "error",
      error: String(error),
      expectedRoute: normalizeExpectedRoute(c.expectedAction),
      predictedRoute: null,
      routeCorrect: c.expectedAction === null ? null : false,
    };
  }
}

function pct(n: number, d: number) {
  return d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`;
}

function ratio(n: number, d: number) {
  return d === 0 ? 0 : n / d;
}

function readNumberFlag(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

function readThresholds(): Thresholds {
  return {
    minIntent: readNumberFlag("--min-intent"),
    minSlot: readNumberFlag("--min-slot"),
    maxUnsafe: readNumberFlag("--max-unsafe"),
    minRoute: readNumberFlag("--min-route"),
  };
}

function assertThresholds(input: {
  thresholds: Thresholds;
  intentAccuracy: number;
  slotRecall: number;
  unsafeAutoRunRate: number;
  routeAccuracy: number;
}) {
  const failures: string[] = [];

  if (input.thresholds.minRoute !== undefined && input.routeAccuracy < input.thresholds.minRoute) {
    failures.push(`route accuracy ${input.routeAccuracy.toFixed(3)} < min ${input.thresholds.minRoute}`);
  }

  if (input.thresholds.minIntent !== undefined && input.intentAccuracy < input.thresholds.minIntent) {
    failures.push(`intent accuracy ${input.intentAccuracy.toFixed(3)} < min ${input.thresholds.minIntent}`);
  }
  if (input.thresholds.minSlot !== undefined && input.slotRecall < input.thresholds.minSlot) {
    failures.push(`slot recall ${input.slotRecall.toFixed(3)} < min ${input.thresholds.minSlot}`);
  }
  if (input.thresholds.maxUnsafe !== undefined && input.unsafeAutoRunRate > input.thresholds.maxUnsafe) {
    failures.push(`unsafe auto-run rate ${input.unsafeAutoRunRate.toFixed(3)} > max ${input.thresholds.maxUnsafe}`);
  }

  if (!failures.length) return;

  console.error("\nRegression thresholds failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

async function main() {
  const thresholds = readThresholds();

  const modeArg = process.argv.indexOf("--mode");
  if (modeArg > -1 && process.argv[modeArg + 1] === "heuristic") {
    process.env.TASK_UNDERSTANDING_MODE = "heuristic";
  }

  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
  const casesArg = process.argv.indexOf("--cases");
  const casesFile = casesArg > -1 ? process.argv[casesArg + 1] : "cases.json";

  const cases = (JSON.parse(readFileSync(join(HERE, casesFile), "utf8")) as EvalCase[]).slice(0, limit);
  const concurrency = process.env.TASK_UNDERSTANDING_MODE === "heuristic" ? 20 : 4;

  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i += concurrency) {
    const batch = cases.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(runCase)));
    process.stdout.write(`\r${results.length}/${cases.length} processed`);
  }
  console.log();

  const intentEval = results.filter((result) => result.intentCorrect !== null);
  const intentOk = intentEval.filter((result) => result.intentCorrect).length;

  const needClarification = results.filter((result) => result.clarificationRequired);
  const flagged = results.filter((result) => result.flaggedForReview);
  const truePositive = needClarification.filter((result) => result.flaggedForReview).length;
  const unsafe = results.filter((result) => result.unsafeAutoRun).length;

  const slotTotal = results.reduce((sum, result) => sum + result.slotTotal, 0);
  const slotHits = results.reduce((sum, result) => sum + result.slotHits, 0);

  const errors = results.filter((result) => result.error);
  const engineCounts = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.engine] = (acc[result.engine] ?? 0) + 1;
    return acc;
  }, {});

  const intentAccuracy = ratio(intentOk, intentEval.length);
  const slotRecall = ratio(slotHits, slotTotal);
  const unsafeAutoRunRate = ratio(unsafe, needClarification.length);

  const routeEval = results.filter((result) => result.routeCorrect !== null);
  const routeOk = routeEval.filter((result) => result.routeCorrect).length;
  const routeAccuracy = ratio(routeOk, routeEval.length);

  console.log("\n===== FlowFit Understanding Evaluation =====");
  console.log(`Cases: ${results.length}  |  Engines: ${JSON.stringify(engineCounts)}  |  Errors: ${errors.length}`);
  console.log(`1) Intent Accuracy        : ${pct(intentOk, intentEval.length)} (${intentOk}/${intentEval.length})`);
  console.log(`2) Clarification Recall   : ${pct(truePositive, needClarification.length)} (${truePositive}/${needClarification.length})`);
  console.log(`   Clarification Precision: ${pct(truePositive, flagged.length)} (${truePositive}/${flagged.length})`);
  console.log(`3) Slot Recall            : ${pct(slotHits, slotTotal)} (${slotHits}/${slotTotal})`);
  console.log(`4) Unsafe Auto-run Rate   : ${pct(unsafe, needClarification.length)} (${unsafe}/${needClarification.length}) - lower is better`);
  console.log(`5) Route Accuracy         : ${pct(routeOk, routeEval.length)} (${routeOk}/${routeEval.length})`);

  const routeConfusion = new Map<string, number>();
  for (const result of routeEval) {
    if (result.routeCorrect) continue;
    const key = `${result.expectedRoute} -> ${result.predictedRoute}`;
    routeConfusion.set(key, (routeConfusion.get(key) ?? 0) + 1);
  }
  if (routeConfusion.size > 0) {
    console.log("\n--- Route confusion (expected -> predicted) ---");
    for (const [key, count] of [...routeConfusion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`${key.padEnd(50)} ${count}`);
    }
  }

  const byIntent = new Map<string, { ok: number; total: number }>();
  for (const result of intentEval) {
    const entry = byIntent.get(result.goldIntent) ?? { ok: 0, total: 0 };
    entry.total += 1;
    if (result.intentCorrect) entry.ok += 1;
    byIntent.set(result.goldIntent, entry);
  }

  console.log("\n--- Accuracy by intent ---");
  for (const [intent, { ok, total }] of [...byIntent.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`${intent.padEnd(20)} ${pct(ok, total).padStart(7)} (${ok}/${total})`);
  }

  const outDir = join(HERE, "results");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = join(outDir, `run-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), engineCounts, results }, null, 1));
  console.log(`\nDetailed results saved: ${outPath}`);

  const failures = results.filter((result) => result.intentCorrect === false).slice(0, 10);
  if (failures.length > 0) {
    console.log("\n--- Intent failures (first 10) ---");
    for (const failure of failures) {
      console.log(`${failure.id}: expected=${failure.expected} predicted=${failure.predicted}`);
    }
  }

  assertThresholds({ thresholds, intentAccuracy, slotRecall, unsafeAutoRunRate, routeAccuracy });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
