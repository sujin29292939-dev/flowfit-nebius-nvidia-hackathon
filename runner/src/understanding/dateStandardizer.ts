import type { ExtractedBusinessFields, TaskPriority } from "./types.js";

export interface DueDateParseResult {
  dueDateText?: string;
  dueDate?: string;
  priority: TaskPriority;
}

const WEEKDAY_INDEX: Record<string, number> = {
  일요일: 0,
  월요일: 1,
  화요일: 2,
  수요일: 3,
  목요일: 4,
  금요일: 5,
  토요일: 6,
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

export function standardizeBusinessFields(
  fields: ExtractedBusinessFields,
  rawText: string,
  receivedAt?: string,
): ExtractedBusinessFields {
  const baseDate = parseBaseDate(receivedAt);
  const parseTarget = [fields.dueDateText, rawText].filter(Boolean).join(" ");
  const parsed = parseKoreanRelativeDueDate(parseTarget, baseDate);
  const dueDate = normalizeIsoDate(fields.dueDate) ?? parsed.dueDate;

  return {
    ...fields,
    dueDateText: fields.dueDateText ?? parsed.dueDateText,
    dueDate,
    priority: fields.priority ?? inferPriority(parseTarget, dueDate, baseDate, parsed.priority),
  };
}

export function parseKoreanRelativeDueDate(text: string, baseDate = new Date()): DueDateParseResult {
  const normalized = normalizeText(text);
  const result: DueDateParseResult = { priority: inferPriority(normalized, undefined, baseDate) };

  const explicit = parseExplicitDate(normalized, baseDate);
  if (explicit) return explicit;

  if (/(asap|최대한\s*빨리|가능한\s*빨리|빠르게)/i.test(normalized)) {
    const date = new Date(baseDate);
    date.setHours(date.getHours() + 2, 0, 0, 0);
    return { dueDateText: "ASAP", dueDate: date.toISOString(), priority: "high" };
  }

  if (/(긴급|즉시|바로)/.test(normalized)) {
    const date = new Date(baseDate);
    date.setHours(date.getHours() + 2, 0, 0, 0);
    return { dueDateText: "긴급", dueDate: date.toISOString(), priority: "urgent" };
  }

  if (/(오늘|당일)/.test(normalized)) {
    return {
      dueDateText: findDuePhrase(text, /(오늘\s*중|오늘\s*까지|오늘|당일)/) ?? "오늘",
      dueDate: withTimeHint(addDays(baseDate, 0), normalized).toISOString(),
      priority: "high",
    };
  }

  if (/내일/.test(normalized)) {
    return {
      dueDateText: findDuePhrase(text, /(내일\s*(오전|오후|아침|점심|저녁)?|내일까지)/) ?? "내일",
      dueDate: withTimeHint(addDays(baseDate, 1), normalized).toISOString(),
      priority: "high",
    };
  }

  if (/모레/.test(normalized)) {
    return {
      dueDateText: findDuePhrase(text, /(모레\s*(오전|오후|아침|점심|저녁)?|모레까지)/) ?? "모레",
      dueDate: withTimeHint(addDays(baseDate, 2), normalized).toISOString(),
      priority: "normal",
    };
  }

  const weekResult = parseWeekExpression(normalized, baseDate);
  if (weekResult) return weekResult;

  return result;
}

function parseExplicitDate(text: string, baseDate: Date): DueDateParseResult | null {
  const koreanDate = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (koreanDate) {
    const date = buildMonthDayDate(baseDate, Number(koreanDate[1]), Number(koreanDate[2]));
    return {
      dueDateText: koreanDate[0],
      dueDate: withTimeHint(date, text).toISOString(),
      priority: inferPriority(text, date.toISOString(), baseDate),
    };
  }

  const slashDate = text.match(/(?:^|\s)(\d{1,2})[./-](\d{1,2})(?:\s|$)/);
  if (slashDate) {
    const date = buildMonthDayDate(baseDate, Number(slashDate[1]), Number(slashDate[2]));
    return {
      dueDateText: slashDate[0].trim(),
      dueDate: withTimeHint(date, text).toISOString(),
      priority: inferPriority(text, date.toISOString(), baseDate),
    };
  }

  return null;
}

function parseWeekExpression(text: string, baseDate: Date): DueDateParseResult | null {
  const weekdayMatch = text.match(/(이번\s*주|다음\s*주)?\s*(월요일|화요일|수요일|목요일|금요일|토요일|일요일|월|화|수|목|금|토|일)\s*(까지|전|오전|오후)?/);
  if (weekdayMatch && (weekdayMatch[1] || weekdayMatch[3])) {
    const targetWeekday = WEEKDAY_INDEX[weekdayMatch[2]];
    const nextWeek = /다음\s*주/.test(weekdayMatch[1] ?? "");
    const date = dateForWeekday(baseDate, targetWeekday, nextWeek);
    return {
      dueDateText: weekdayMatch[0].trim(),
      dueDate: withTimeHint(date, text).toISOString(),
      priority: nextWeek ? "normal" : "high",
    };
  }

  if (/이번\s*주\s*까지|이번주\s*까지/.test(text)) {
    const friday = dateForWeekday(baseDate, 5, false);
    return {
      dueDateText: "이번 주까지",
      dueDate: withTimeHint(friday, text).toISOString(),
      priority: "high",
    };
  }

  if (/다음\s*주\s*까지|다음주\s*까지/.test(text)) {
    const friday = dateForWeekday(baseDate, 5, true);
    return {
      dueDateText: "다음 주까지",
      dueDate: withTimeHint(friday, text).toISOString(),
      priority: "normal",
    };
  }

  return null;
}

function inferPriority(text: string, dueDate?: string, baseDate = new Date(), fallback: TaskPriority = "normal"): TaskPriority {
  const normalized = normalizeText(text);
  if (/(긴급|즉시|바로)/.test(normalized)) return "urgent";
  if (/(asap|최대한\s*빨리|가능한\s*빨리|오늘|당일|내일|이번\s*주|이번주)/i.test(normalized)) return "high";

  if (dueDate) {
    const dueTime = Date.parse(dueDate);
    if (Number.isFinite(dueTime)) {
      const hoursLeft = (dueTime - baseDate.getTime()) / 3_600_000;
      if (hoursLeft <= 6) return "urgent";
      if (hoursLeft <= 48) return "high";
    }
  }

  return fallback;
}

function withTimeHint(date: Date, text: string) {
  const next = new Date(date);
  const explicitHour = text.match(/(오전|오후)?\s*(\d{1,2})\s*시/);
  if (explicitHour) {
    let hour = Number(explicitHour[2]);
    if (explicitHour[1] === "오후" && hour < 12) hour += 12;
    if (explicitHour[1] === "오전" && hour === 12) hour = 0;
    next.setHours(hour, 0, 0, 0);
    return next;
  }

  if (/오전|아침/.test(text)) next.setHours(10, 0, 0, 0);
  else if (/점심/.test(text)) next.setHours(12, 0, 0, 0);
  else if (/오후/.test(text)) next.setHours(15, 0, 0, 0);
  else if (/저녁/.test(text)) next.setHours(18, 0, 0, 0);
  else next.setHours(18, 0, 0, 0);
  return next;
}

function buildMonthDayDate(baseDate: Date, month: number, day: number) {
  const date = new Date(baseDate);
  date.setMonth(month - 1, day);
  if (date.getTime() < baseDate.getTime() - 86_400_000) {
    date.setFullYear(date.getFullYear() + 1);
  }
  return date;
}

function dateForWeekday(baseDate: Date, targetWeekday: number, nextWeek: boolean) {
  const date = new Date(baseDate);
  const current = date.getDay();
  let days = targetWeekday - current;
  if (days < 0) days += 7;
  if (nextWeek) days += days === 0 ? 7 : 7;
  return addDays(baseDate, days);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeIsoDate(value?: string) {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return new Date(time).toISOString();
}

function parseBaseDate(value?: string) {
  if (!value) return new Date();
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : new Date();
}

function findDuePhrase(text: string, pattern: RegExp) {
  return text.match(pattern)?.[0]?.trim();
}
