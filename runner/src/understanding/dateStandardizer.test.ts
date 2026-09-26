import assert from "node:assert/strict";
import { parseKoreanRelativeDueDate, standardizeBusinessFields } from "./dateStandardizer.js";

const base = new Date("2026-07-04T00:00:00.000Z");

const tomorrowMorning = parseKoreanRelativeDueDate("내일 오전까지 보내줘", base);
assert.equal(tomorrowMorning.priority, "high");
assert.ok(tomorrowMorning.dueDate);
assert.ok(Date.parse(tomorrowMorning.dueDate!) > base.getTime());

const asap = parseKoreanRelativeDueDate("ASAP 처리", base);
assert.equal(asap.priority, "high");
assert.ok(asap.dueDate);

const urgent = parseKoreanRelativeDueDate("긴급으로 바로 처리", base);
assert.equal(urgent.priority, "urgent");
assert.ok(urgent.dueDate);

const standardized = standardizeBusinessFields(
  { dueDateText: "이번 주까지" },
  "A거래처 주문 이번 주까지 처리",
  base.toISOString(),
);
assert.equal(standardized.priority, "high");
assert.ok(standardized.dueDate);

console.log("dateStandardizer.test passed");
