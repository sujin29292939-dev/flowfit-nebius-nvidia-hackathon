import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type AutoProcessingCriteriaTone = "emerald" | "sky" | "amber" | "rose" | "violet";

export type AutoProcessingCriteriaKeyword = {
  id: string;
  label: string;
  source: "system" | "user";
  createdAt: string;
};

export type AutoProcessingCriterion = {
  id: string;
  title: string;
  description: string;
  tone: AutoProcessingCriteriaTone;
  autoAllowed: boolean;
  keywords: AutoProcessingCriteriaKeyword[];
};

const DATA_DIR = path.join(process.cwd(), ".flowfit");
const DATA_FILE = path.join(DATA_DIR, "auto-processing-criteria-keywords.json");

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function systemKeyword(label: string): AutoProcessingCriteriaKeyword {
  return {
    id: `keyword-${label.replace(/\s+/g, "-")}`,
    label,
    source: "system",
    createdAt: "2026-05-12T00:00:00.000Z",
  };
}

export const initialAutoProcessingCriteria: AutoProcessingCriterion[] = [
  {
    id: "internal-classification",
    title: "내부 분류",
    description: "고객에게 발송하지 않고 문의나 기록의 유형만 나누는 작업",
    tone: "emerald",
    autoAllowed: true,
    keywords: ["내부 분류", "미응답 분류", "배송 문의 분류", "주문 변경 분류", "일반 문의 분류"].map(systemKeyword),
  },
  {
    id: "internal-record",
    title: "내부 기록 저장",
    description: "결과를 내부 로그, 상태, 태그로만 저장하는 되돌리기 쉬운 작업",
    tone: "sky",
    autoAllowed: true,
    keywords: ["내부 기록", "기록 저장", "상태 업데이트", "태그 정리", "처리 결과 저장"].map(systemKeyword),
  },
  {
    id: "repeat-reminder",
    title: "반복 알림",
    description: "반복 확인이나 미처리 항목 알림처럼 외부 발송 전 단계의 작업",
    tone: "violet",
    autoAllowed: true,
    keywords: ["반복 알림", "미응답 알림", "재고 기준치 알림", "매주 확인", "follow-up 정리"].map(systemKeyword),
  },
  {
    id: "low-risk-draft",
    title: "낮은 위험도 초안",
    description: "외부 실행 없이 보고서나 요약 초안만 만드는 작업",
    tone: "amber",
    autoAllowed: true,
    keywords: ["보고서 초안", "요약 보고", "낮은 위험도", "되돌리기 가능", "운영 개선안"].map(systemKeyword),
  },
  {
    id: "approval-guard",
    title: "승인함으로 보낼 기준",
    description: "고객 발송, 금전, 계약, 클레임 결정처럼 자동 처리하지 않는 작업",
    tone: "rose",
    autoAllowed: false,
    keywords: ["외부 발송", "고객 발송", "금전", "계약", "클레임 결정", "환불", "주문 확정"].map(systemKeyword),
  },
];

async function ensureDataFile() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(DATA_FILE, "utf8");
  } catch {
    await writeFile(DATA_FILE, JSON.stringify(initialAutoProcessingCriteria, null, 2), "utf8");
  }
}

function normalizeCriteria(value: unknown): AutoProcessingCriterion[] {
  if (!Array.isArray(value)) return initialAutoProcessingCriteria;

  return value
    .map((item) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const initial = initialAutoProcessingCriteria.find((criterion) => criterion.id === record.id);
      if (!initial) return null;

      const keywords = Array.isArray(record.keywords)
        ? record.keywords
            .map((keyword) => {
              const keywordRecord = keyword && typeof keyword === "object" ? (keyword as Record<string, unknown>) : {};
              const label = typeof keywordRecord.label === "string" ? keywordRecord.label.trim().slice(0, 32) : "";
              if (!label) return null;

              return {
                id: typeof keywordRecord.id === "string" ? keywordRecord.id : makeId("keyword"),
                label,
                source: keywordRecord.source === "user" ? "user" : "system",
                createdAt: typeof keywordRecord.createdAt === "string" ? keywordRecord.createdAt : new Date().toISOString(),
              } satisfies AutoProcessingCriteriaKeyword;
            })
            .filter((keyword): keyword is AutoProcessingCriteriaKeyword => Boolean(keyword))
        : initial.keywords;

      return {
        ...initial,
        keywords,
      };
    })
    .filter((criterion): criterion is AutoProcessingCriterion => Boolean(criterion));
}

export async function readAutoProcessingCriteria() {
  await ensureDataFile();

  try {
    const raw = await readFile(DATA_FILE, "utf8");
    return normalizeCriteria(JSON.parse(raw));
  } catch {
    return initialAutoProcessingCriteria;
  }
}

export async function saveAutoProcessingCriteria(criteria: AutoProcessingCriterion[]) {
  await ensureDataFile();
  await writeFile(DATA_FILE, JSON.stringify(criteria, null, 2), "utf8");
}

export async function addAutoProcessingKeyword(criterionId: string, label: string) {
  const criteria = await readAutoProcessingCriteria();
  const trimmed = label.trim().replace(/\s+/g, " ").slice(0, 32);

  if (!trimmed) {
    return criteria;
  }

  const next: AutoProcessingCriterion[] = criteria.map((criterion) => {
    if (criterion.id !== criterionId) return criterion;
    const exists = criterion.keywords.some((keyword) => keyword.label.toLowerCase() === trimmed.toLowerCase());
    if (exists) return criterion;

    const keyword: AutoProcessingCriteriaKeyword = {
      id: makeId("keyword"),
      label: trimmed,
      source: "user",
      createdAt: new Date().toISOString(),
    };

    return {
      ...criterion,
      keywords: [...criterion.keywords, keyword],
    };
  });

  await saveAutoProcessingCriteria(next);
  return next;
}

export async function deleteAutoProcessingKeyword(criterionId: string, keywordId: string) {
  const criteria = await readAutoProcessingCriteria();
  const next = criteria.map((criterion) => {
    if (criterion.id !== criterionId) return criterion;
    return {
      ...criterion,
      keywords: criterion.keywords.filter((keyword) => keyword.id !== keywordId || keyword.source === "system"),
    };
  });

  await saveAutoProcessingCriteria(next);
  return next;
}
