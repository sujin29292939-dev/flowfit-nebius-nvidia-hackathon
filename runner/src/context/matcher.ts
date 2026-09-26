// context/matcher.ts
// 회사별 이름/별칭 매칭. LLM 없이도 실무 테스트가 가능해야 하므로 결정적 점수만 사용한다.

import type { ContextCandidate, EntityContextMatch } from "./types.js";

interface MatchableRecord {
  id: string;
  name: string;
  aliases: string[];
}

export function matchEntity(query: string | undefined, records: MatchableRecord[]): EntityContextMatch {
  const normalizedQuery = normalizeName(query ?? "");
  if (!normalizedQuery) {
    return {
      kind: "not_found",
      score: 0,
      reason: "입력에서 비교할 이름을 찾지 못함",
      candidates: [],
    };
  }

  const candidates = records
    .map((record) => scoreRecord(normalizedQuery, record))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const best = candidates[0];
  if (!best) {
    return {
      kind: "not_found",
      score: 0,
      reason: "회사 데이터에서 일치 후보 없음",
      candidates: [],
    };
  }

  const kind =
    best.reason === "name_exact" ? "exact" :
    best.reason === "alias_exact" ? "alias" :
    best.score >= 0.72 ? "fuzzy" :
    "not_found";

  if (kind === "not_found") {
    return {
      kind,
      score: best.score,
      reason: "후보는 있으나 자동 매칭 기준 미달",
      candidates,
    };
  }

  return {
    kind,
    id: best.id,
    name: best.name,
    score: best.score,
    reason: reasonLabel(best.reason),
    candidates,
  };
}

export function notNeededMatch(reason: string): EntityContextMatch {
  return {
    kind: "not_needed",
    score: 1,
    reason,
    candidates: [],
  };
}

function scoreRecord(query: string, record: MatchableRecord): ContextCandidate {
  const names = [
    { value: record.name, reason: "name" },
    ...record.aliases.map((alias) => ({ value: alias, reason: "alias" })),
  ];

  let best = { score: 0, reason: "no_match" };
  for (const name of names) {
    const normalized = normalizeName(name.value);
    if (!normalized) continue;

    if (normalized === query) {
      const reason = name.reason === "alias" ? "alias_exact" : "name_exact";
      best = pickBest(best, { score: name.reason === "alias" ? 0.97 : 1, reason });
      continue;
    }

    if (normalized.includes(query) || query.includes(normalized)) {
      const ratio = Math.min(normalized.length, query.length) / Math.max(normalized.length, query.length);
      best = pickBest(best, { score: clamp(0.78 + ratio * 0.12), reason: `${name.reason}_contains` });
      continue;
    }

    const dice = diceCoefficient(query, normalized);
    const overlap = charOverlap(query, normalized);
    best = pickBest(best, {
      score: clamp(dice * 0.72 + overlap * 0.2),
      reason: `${name.reason}_similar`,
    });
  }

  return {
    id: record.id,
    name: record.name,
    score: Number(best.score.toFixed(2)),
    reason: best.reason,
  };
}

export function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[㈜()_\-.,·]/g, "")
    .replace(/주식회사/g, "")
    .replace(/유한회사/g, "")
    .trim();
}

function diceCoefficient(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  let matches = 0;
  const used = new Set<number>();

  for (const token of aBigrams) {
    const index = bBigrams.findIndex((candidate, i) => candidate === token && !used.has(i));
    if (index >= 0) {
      matches += 1;
      used.add(index);
    }
  }

  return (2 * matches) / (aBigrams.length + bBigrams.length);
}

function bigrams(value: string) {
  const result: string[] = [];
  for (let i = 0; i < value.length - 1; i += 1) {
    result.push(value.slice(i, i + 2));
  }
  return result;
}

function charOverlap(a: string, b: string) {
  const aChars = new Set([...a]);
  const bChars = new Set([...b]);
  let common = 0;
  for (const ch of aChars) {
    if (bChars.has(ch)) common += 1;
  }
  return common / Math.max(aChars.size, bChars.size, 1);
}

function pickBest(current: { score: number; reason: string }, next: { score: number; reason: string }) {
  return next.score > current.score ? next : current;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function reasonLabel(reason: string) {
  return {
    name_exact: "정식 이름과 정확히 일치",
    alias_exact: "등록된 별칭과 정확히 일치",
    name_contains: "정식 이름과 부분 일치",
    alias_contains: "등록된 별칭과 부분 일치",
    name_similar: "정식 이름과 유사",
    alias_similar: "등록된 별칭과 유사",
  }[reason] ?? "유사도 기반 후보";
}
