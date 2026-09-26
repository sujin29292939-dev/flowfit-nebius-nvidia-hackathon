// timeline/taskTimeline.test.ts
// GET /tasks/:id/timeline 라우트가 호출하는 getTaskTimeline()을 실제 DB 스키마에
// 대고 실행하는 회귀 테스트. intakes 테이블에 없는 컬럼(updated_at)을
// 쿼리에 남겨두면 여기서 즉시 실패한다.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isDatabaseConfigured, sql } from "../db/client.js";
import { createIntake } from "../intake/store.js";
import { getTaskTimeline } from "./taskTimeline.js";

if (!isDatabaseConfigured()) {
  console.error("SKIP taskTimeline.test: DATABASE_URL not configured");
  process.exit(0);
}

let failed = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
}

const companyId = `company_timeline_regress_${Date.now()}`;
const taskId = `task_timeline_regress_${randomUUID()}`;

try {
  const intake = await createIntake({
    companyId,
    companyName: "Timeline Regression Test Co",
    sourceType: "sms",
    sourceName: "regression_test",
    rawText: "회귀 테스트: timeline 라우트를 실제 DB 스키마로 검증",
  });

  await sql`
    INSERT INTO tasks (id, company_id, intake_id, task_type, status, extracted_fields_json, risk_level)
    VALUES (${taskId}, ${companyId}, ${intake.id}, 'order_request', 'needs_review', '{}'::jsonb, 'uncertain')
  `;

  let result: Awaited<ReturnType<typeof getTaskTimeline>> | undefined;
  try {
    result = await getTaskTimeline(taskId);
    check("getTaskTimeline resolves without throwing against live schema", true);
  } catch (error) {
    check("getTaskTimeline resolves without throwing against live schema", false, String(error));
  }

  if (result) {
    const intakeItem = result.items.find((item) => item.type === "intake_received");
    check("timeline includes intake_received item", Boolean(intakeItem));
    check(
      "intake item's updated_at is aliased from created_at (intakes 테이블엔 실제 updated_at 컬럼이 없음)",
      Boolean(intakeItem) && intakeItem!.data.updated_at === intakeItem!.data.created_at,
      JSON.stringify(intakeItem?.data),
    );
    check("timeline includes task_created item", result.items.some((item) => item.type === "task_created"));
  }
} finally {
  await sql`DELETE FROM companies WHERE id = ${companyId}`;
}

assert.equal(failed, 0, `${failed} taskTimeline test(s) failed`);
console.log("\nAll taskTimeline tests passed");
