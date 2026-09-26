// test/recovery-eval/run.ts
// 복구 정책 회귀 평가: recoveryPolicy 결정 vs 데이터셋 engine_decision.
//
// 사용법: npx tsx test/recovery-eval/run.ts
//
// 지표:
//   1) 전체 정확도
//   2) 안전 핵심 지표: BLOCK을 놓친 비율(false-negative) = 0이어야 함
//   3) 위험 방향 오류: 데이터셋이 승인/차단인데 정책이 자동으로 낮춘 비율(과소 대응)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { decideRecovery, DECISION_LABEL_TO_CODE } from "../../src/recovery/recoveryPolicy.js";
import type { FailureOrigin, JobRisk, MismatchCode, RecoveryDecision } from "../../src/recovery/recoveryPolicy.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Case {
  mismatch: MismatchCode;
  failureOrigin: FailureOrigin;
  jobRisk: JobRisk;
  expected: string;
  stage: string;
  action: string;
}

/** 자동화 강도 순위 — 낮을수록 자동, 높을수록 사람 개입 */
const STRENGTH: Record<RecoveryDecision, number> = {
  AUTO_RECOVER: 0,
  RECONCILE: 1,
  APPROVAL: 2,
  BLOCK: 3,
};

function pct(n: number, d: number) {
  return d === 0 ? "-" : `${((n / d) * 100).toFixed(2)}%`;
}

function main() {
  const cases = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8")) as Case[];

  let correct = 0;
  let blockMissed = 0;       // 데이터셋 BLOCK인데 정책이 BLOCK 아님 (치명)
  let underReacted = 0;      // 정책이 데이터셋보다 약하게 대응 (위험 방향)
  let overReacted = 0;       // 정책이 데이터셋보다 강하게 대응 (안전하지만 과함)
  const confusion = new Map<string, number>();

  for (const c of cases) {
    const expected = DECISION_LABEL_TO_CODE[c.expected];
    const got = decideRecovery({ mismatch: c.mismatch, failureOrigin: c.failureOrigin, jobRisk: c.jobRisk, stage: c.stage }).decision;

    if (got === expected) {
      correct += 1;
    } else {
      const key = `${c.expected} → ${got}`;
      confusion.set(key, (confusion.get(key) ?? 0) + 1);
      if (STRENGTH[got] < STRENGTH[expected]) underReacted += 1;
      else overReacted += 1;
    }
    if (expected === "BLOCK" && got !== "BLOCK") blockMissed += 1;
  }

  console.log("\n===== FlowFit 복구 정책 회귀 평가 =====");
  console.log(`케이스: ${cases.length}`);
  console.log(`1) 전체 정확도          : ${pct(correct, cases.length)} (${correct}/${cases.length})`);
  console.log(`2) BLOCK 누락(치명)     : ${blockMissed}건 — 0이어야 함`);
  console.log(`3) 과소 대응(위험 방향) : ${pct(underReacted, cases.length)} (${underReacted}건)`);
  console.log(`   과대 대응(안전 방향) : ${pct(overReacted, cases.length)} (${overReacted}건)`);

  if (confusion.size > 0) {
    console.log("\n--- 오분류 (expected → got) ---");
    for (const [key, count] of [...confusion.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`${key.padEnd(36)} ${count}`);
    }
  }

  // 안전 게이트: BLOCK 누락이 있으면 실패
  if (blockMissed > 0) {
    console.error(`\n❌ 안전 실패: BLOCK ${blockMissed}건 누락`);
    process.exit(1);
  }
  console.log("\n✅ 안전 핵심(BLOCK 누락 0) 통과");
}

main();
