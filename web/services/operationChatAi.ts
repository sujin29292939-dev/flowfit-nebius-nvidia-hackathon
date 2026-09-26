import {
  chatRunnerMessage,
  runChatWorkPipeline,
  understandRunnerMessage,
  type RunnerChatHistoryMessage,
  type RunnerChatWorkResponse,
} from "@/services/runnerClient";
import { adminSettings } from "@/lib/mock-db";
import type { WholesaleSettingsModuleRoute } from "@/lib/types";
import { getWholesaleModuleSettings } from "@/lib/wholesale-settings";
import { readAutoProcessingCriteria } from "@/services/autoProcessingCriteriaStore";
import type { OperationChatMessage } from "@/services/operationChatFileStore";

/** 파이프라인을 태우지 않고 일반 대화로 처리하는 타입 */
const generalChatTaskTypes = new Set(["general_request", "unknown", ""]);

export const FLOWFIT_SINGLE_OPERATION_SYSTEM_PROMPT = [
  "# 역할",
  "당신은 B2B 도매/제조업 대표의 단일 AI 운영 비서입니다. 사장은 채팅 하나만으로 회사를 운영하며, 현장 접수, 작업 승인, 진행 중 업무, 직원 확인 요청을 모두 채팅 메시지로 처리합니다.",
  "# 핵심 사상",
  "채팅 타임라인은 회사의 공식 운영 기록이자 감사 로그입니다. 모든 항목은 메시지 type 분기로 표현합니다. 외부 이벤트도 메시지로 진입합니다. 사장 승인 전에는 어떤 정보도 공식 정보로 사용하거나 외부로 발송하지 않습니다.",
  "# 정보 등급",
  "[1] 원본 임시 정보: 직원 업로드 원본. 공식 처리 불가.",
  "[2] AI 정리 정보: AI가 추출한 후보. 외부 발송 불가.",
  "[3] 검토 대기 정보: 사장 확인 전. 내부 참고만 가능.",
  "[4] 확정 정보: 사장 수락 후. AI 판단의 강한 근거로 사용.",
  "# 출력 규약",
  "모든 응답은 JSON 하나만 출력합니다. type은 ai_text, ai_briefing, ai_card_intake, ai_card_approval, ai_card_progress, ai_card_employee_request, ai_card_auto_criteria, system_event 중 하나입니다. 자연어 답변도 ai_text.payload.text에 담습니다.",
  "# 의사결정 규칙",
  "외부 발송과 금전·계약·고객 영향은 high, 외부 발송 일반 안내는 medium, 정보 부족은 requires_check, 내부 참고만은 low입니다. missing이 있으면 외부 발송은 false입니다. 클레임, 환불, 지연, 사고는 urgent입니다.",
  "# 직원 보호 규칙",
  "직원에게 보내는 visibleToEmployee에는 위험도, 신뢰도, 내부 판단, 회사 전체 데이터를 포함하지 않습니다. internalReason은 사장 전용입니다.",
  "# 톤과 언어",
  "한국어. 결론 우선. 한 메시지에 한 결정 사항. 카드 텍스트는 짧게 작성합니다.",
].join("\n");

const fieldLabels: Array<[string, string]> = [
  ["customerName", "거래처"],
  ["itemName", "품목"],
  ["quantity", "수량"],
  ["unit", "단위"],
  ["dueDateText", "납기/일정"],
  ["deliveryAddress", "배송지"],
  ["orderNumber", "주문번호"],
  ["trackingNumber", "송장번호"],
  ["amount", "금액"],
  ["depositorName", "입금자"],
  ["contactName", "담당자"],
  ["requestedReplyChannel", "응답 채널"],
];

const requiredFieldsByTaskType: Record<string, string[]> = {
  order_request: ["customerName", "itemName", "quantity"],
  quote_request: ["customerName", "itemName", "quantity"],
};

const exceptionKeywordPresets = [
  "환불",
  "취소",
  "분쟁",
  "불만",
  "결제오류",
  "재발급",
  "변경",
  "지연",
  "미수령",
  "파손",
  "오배송",
  "주소변경",
  "계정문제",
  "긴급",
  "사고",
];

function shouldShowPartnerCandidateCard(message: string) {
  const normalized = message.replace(/\s+/g, "");
  if (!normalized.includes("A거래처")) return false;
  return ["후보", "발주", "주문", "추가", "3박스", "내일"].some((keyword) => normalized.includes(keyword));
}

type StructuredMessageType =
  | "ai_text"
  | "ai_briefing"
  | "ai_card_intake"
  | "ai_card_approval"
  | "ai_card_progress"
  | "ai_card_employee_request"
  | "ai_card_auto_criteria"
  | "ai_card_settings_update"
  | "system_event";

function buildStructuredMessage(type: StructuredMessageType, payload: Record<string, unknown>) {
  return JSON.stringify({ type, payload }, null, 2);
}

const settingsModuleLabels: Record<WholesaleSettingsModuleRoute, string> = {
  dunning: "미수금 설정",
  delivery: "납기 설정",
  "account-health": "거래처 건강 설정",
  pricing: "단가표 설정",
  claims: "반품·클레임 설정",
};

const settingsFieldLabels: Record<string, string> = {
  p1AmountThreshold: "P1 미수 알림 금액",
  p1OverdueDays: "P1 연체 일수",
  reminderDaysBeforeDue: "사전 알림 일수",
  followUpCadenceDays: "재알림 주기",
  dormantAfterDays: "장기 미응답 관리 일수",
  alertChannels: "알림 채널",
  autoCreateDraftNotice: "미수 안내 초안 자동 생성",
  pauseOnWeekends: "주말 알림 일시 중지",
  enableD3Alerts: "D-3 알림",
  enableD1Alerts: "D-1 알림",
  enableDelayAlerts: "지연 알림",
  delayThresholdDays: "지연 판정 일수",
  perPartnerRulesEnabled: "거래처별 규칙",
  managerEscalationHours: "담당자 재확인 시간",
  autoCreateDelayNotice: "지연 안내 초안 자동 생성",
  recencyWeight: "최근성 비중",
  frequencyWeight: "주문 빈도 비중",
  monetaryWeight: "거래 금액 비중",
  warningScoreCutoff: "주의 점수 하향 기준",
  criticalScoreCutoff: "심각 점수 하향 기준",
  orderDropThresholdPercent: "월별 발주 감소율 기준",
  noOrderDaysThreshold: "무주문 일수 기준",
  warningChangeRatePercent: "주의 변동률",
  criticalChangeRatePercent: "심각 변동률",
  impactedPartnerThreshold: "영향 거래처 수 기준",
  enablePartnerSpecificRules: "거래처별 예외 단가 규칙",
  autoCreatePriceNotice: "거래처용 가격 안내 초안",
  defaultNoticeLeadDays: "가격 안내 선행 일수",
  allowedFileTypes: "허용된 파일 읽기 형식",
  autoClassifyEnabled: "AI 클레임 자동 분류",
  enabledCategories: "클레임 분류 항목",
  highPriorityKeywords: "높은 우선순위 키워드",
  mediumPriorityKeywords: "중간 우선순위 키워드",
  autoAssignMode: "기본 배정 방식",
  defaultAssignee: "기본 담당자",
  accumulatedCountThreshold: "누적 경고 기준",
};

function isSettingsCommand(message: string) {
  return /(설정|기준|P1|P2|미수|납기|단가|가격|클레임|반품|거래처\s*건강|RFM|알림|카카오|대시보드|슬랙|이메일)/i.test(message) &&
    /(바꿔|변경|조정|설정|켜|꺼|추가|삭제|저장|적용|으로|로)/.test(message);
}

function inferSettingsModule(message: string): WholesaleSettingsModuleRoute | null {
  const compact = message.replace(/\s+/g, "").toLowerCase();
  if (/(미수|연체|p1|p2|재알림|휴면|입금)/i.test(compact)) return "dunning";
  if (/(납기|배송|출고|지연|d-?3|d-?1|담당자재)/i.test(compact)) return "delivery";
  if (/(거래처건강|rfm|최근성|빈도|금액비중|주의점수|심각점수|발주감소|무주문)/i.test(compact)) return "account-health";
  if (/(단가|가격|변동률|단가표|파일형식|xlsx|csv|pdf|안내선행)/i.test(compact)) return "pricing";
  if (/(클레임|반품|분류|배정|partner-owner|round-robin|manual|누적경고)/i.test(compact)) return "claims";
  return null;
}

function asSettingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstNumber(message: string) {
  const match = message.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function lastNumber(message: string) {
  const matches = [...message.matchAll(/(\d+(?:\.\d+)?)/g)];
  const match = matches.at(-1);
  return match ? Number(match[1]) : null;
}

function moneyAmount(message: string) {
  const unitMatch = [...message.matchAll(/(\d+(?:\.\d+)?)\s*(억|천만|백만|만원|만|원)/g)].at(-1);
  const match = unitMatch ?? message.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] ?? "";
  if (unit === "억") return Math.round(value * 100_000_000);
  if (unit === "천만") return Math.round(value * 10_000_000);
  if (unit === "백만") return Math.round(value * 1_000_000);
  if (unit === "만" || unit === "만원") return Math.round(value * 10_000);
  return Math.round(value);
}

function truthySetting(message: string) {
  if (/(꺼|끄|중지|비활성|삭제|해제|false|off)/i.test(message)) return false;
  if (/(켜|활성|사용|추가|true|on)/i.test(message)) return true;
  return null;
}

function extractChannels(message: string) {
  const channels: string[] = [];
  if (/대시보드|앱\s*내/i.test(message)) channels.push("dashboard");
  if (/카카오|카톡/i.test(message)) channels.push("kakao");
  if (/이메일|메일/i.test(message)) channels.push("email");
  if (/슬랙|slack/i.test(message)) channels.push("slack");
  return channels;
}

function extractListAfter(message: string, anchors: RegExp) {
  const parts = message.split(anchors);
  const source = (parts[1] ?? "").replace(/(으로|로|에|추가|설정|변경|바꿔|해줘|합니다|한다)/g, " ");
  return source
    .split(/[,/·、\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 8);
}

function buildSettingsPatch(module: WholesaleSettingsModuleRoute, message: string, current: Record<string, unknown>) {
  const patch: Record<string, unknown> = { ...current };
  const changed: string[] = [];
  const compact = message.replace(/\s+/g, "");
  const number = lastNumber(message);
  const bool = truthySetting(message);
  const channels = extractChannels(message);

  function set(key: string, value: unknown) {
    if (value === null || value === undefined || value === "") return;
    patch[key] = value;
    changed.push(key);
  }

  if (channels.length && /알림|채널|앱|카카오|이메일|슬랙|대시보드/i.test(message)) {
    set("alertChannels", channels);
  }

  if (module === "dunning") {
    if (/금액|p1/i.test(message)) set("p1AmountThreshold", moneyAmount(message));
    if (/연체|밀리|일수/i.test(message)) set("p1OverdueDays", number);
    if (/사전|예정일|며칠\s*전|몇\s*일\s*전/i.test(message)) set("reminderDaysBeforeDue", number);
    if (/재알림|반복|주기/i.test(message)) set("followUpCadenceDays", number);
    if (/장기|휴면|미응답|반응\s*없는/i.test(message)) set("dormantAfterDays", number);
    if (/초안|안내문/i.test(message) && bool !== null) set("autoCreateDraftNotice", bool);
    if (/주말/i.test(message) && bool !== null) set("pauseOnWeekends", bool);
  }

  if (module === "delivery") {
    if (/d-?3|3일전|3일\s*전/i.test(compact) && bool !== null) set("enableD3Alerts", bool);
    if (/d-?1|하루전|1일\s*전/i.test(compact) && bool !== null) set("enableD1Alerts", bool);
    if (/지연\s*알림|지연경고/i.test(message) && bool !== null) set("enableDelayAlerts", bool);
    if (/지연|판정|몇일부터/i.test(message)) set("delayThresholdDays", number);
    if (/거래처별|개별\s*규칙/i.test(message) && bool !== null) set("perPartnerRulesEnabled", bool);
    if (/담당자|재확인|재호출|시간/i.test(message)) set("managerEscalationHours", number);
    if (/초안|안내문/i.test(message) && bool !== null) set("autoCreateDelayNotice", bool);
  }

  if (module === "account-health") {
    if (/최근성/i.test(message)) set("recencyWeight", number);
    if (/빈도|주문\s*횟수/i.test(message)) set("frequencyWeight", number);
    if (/금액\s*비중|거래\s*금액/i.test(message)) set("monetaryWeight", number);
    if (/주의/i.test(message)) set("warningScoreCutoff", number);
    if (/심각/i.test(message)) set("criticalScoreCutoff", number);
    if (/발주\s*감소|감소율/i.test(message)) set("orderDropThresholdPercent", number);
    if (/무주문|주문\s*없/i.test(message)) set("noOrderDaysThreshold", number);
  }

  if (module === "pricing") {
    if (/주의|노란/i.test(message)) set("warningChangeRatePercent", number);
    if (/심각|큰\s*변동/i.test(message)) set("criticalChangeRatePercent", number);
    if (/거래처\s*수|영향\s*거래처/i.test(message)) set("impactedPartnerThreshold", number);
    if (/거래처별|예외\s*단가|개별\s*단가/i.test(message) && bool !== null) set("enablePartnerSpecificRules", bool);
    if (/초안|안내문/i.test(message) && bool !== null) set("autoCreatePriceNotice", bool);
    if (/선행|며칠\s*전|몇\s*일\s*전|일\s*표시/i.test(message)) set("defaultNoticeLeadDays", number);
    const fileTypes = ["xlsx", "csv", "pdf"].filter((item) => new RegExp(item, "i").test(message));
    if (fileTypes.length) set("allowedFileTypes", fileTypes);
  }

  if (module === "claims") {
    if (/자동\s*분류|ai\s*분류/i.test(message) && bool !== null) set("autoClassifyEnabled", bool);
    if (/분류\s*항목|카테고리/i.test(message)) {
      const categories = extractListAfter(message, /분류\s*항목|카테고리/);
      if (categories.length) set("enabledCategories", categories);
    }
    if (/높은|긴급|심각|우선순위/i.test(message)) {
      const keywords = extractListAfter(message, /키워드|항목|기준/);
      if (keywords.length) set("highPriorityKeywords", keywords.join(", "));
    }
    if (/중간|보통/i.test(message)) {
      const keywords = extractListAfter(message, /키워드|항목|기준/);
      if (keywords.length) set("mediumPriorityKeywords", keywords.join(", "));
    }
    if (/partner-owner|거래처\s*담당/i.test(message)) set("autoAssignMode", "partner-owner");
    if (/round-robin|순환/i.test(message)) set("autoAssignMode", "round-robin");
    if (/manual|수동/i.test(message)) set("autoAssignMode", "manual");
    if (/담당자|배정/i.test(message)) {
      const assignee = extractListAfter(message, /담당자|배정/)[0];
      if (assignee && !/(partner-owner|round-robin|manual|수동|순환)/i.test(assignee)) set("defaultAssignee", assignee);
    }
    if (/누적|경고|건/i.test(message)) set("accumulatedCountThreshold", number);
  }

  return { patch, changed: Array.from(new Set(changed)) };
}

function formatSettingValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "켜짐" : "꺼짐";
  if (value === null || value === undefined) return "";
  return String(value);
}

async function buildSettingsUpdateCard(message: string) {
  const module = inferSettingsModule(message);
  if (!module) return null;
  const current = asSettingsRecord(await getWholesaleModuleSettings(module));
  const { patch, changed } = buildSettingsPatch(module, message, current);

  if (!changed.length) {
    return asAiText("설정에서 바꿀 값까지 함께 말해 주세요. 예: “P1 금액 기준 300만원으로 바꿔줘”, “납기 지연 판정일을 2일로 설정해줘”.");
  }

  return buildStructuredMessage("ai_card_settings_update", {
    module,
    moduleTitle: settingsModuleLabels[module],
    sourceText: message.slice(0, 240),
    changes: changed.map((key) => ({
      key,
      label: settingsFieldLabels[key] ?? key,
      before: formatSettingValue(current[key]),
      after: formatSettingValue(patch[key]),
    })),
    patch,
    actions: ["apply_settings_update", "hold"],
  });
}

function isStructuredJson(content: string) {
  try {
    const parsed = JSON.parse(content.trim()) as { type?: unknown; payload?: unknown };
    return typeof parsed.type === "string" && parsed.payload && typeof parsed.payload === "object";
  } catch {
    return false;
  }
}

function asAiText(text: string) {
  return buildStructuredMessage("ai_text", { text: text.trim() || "응답 없음" });
}

function normalizeAssistantContent(content: string) {
  const trimmed = content.trim();
  return isStructuredJson(trimmed) ? trimmed : asAiText(trimmed);
}

function buildEntryBriefing(message: string) {
  const urgent = /(클레임|환불|지연|사고)/.test(message);

  return buildStructuredMessage("ai_briefing", {
    summary: "현재 채팅 기준 확인이 필요한 항목 1건입니다.",
    items: [
      {
        cardType: "ai_text",
        title: "새 요청 확인",
        priority: urgent ? "urgent" : "normal",
        preview: message.slice(0, 80) || "새 운영 대화를 시작했습니다.",
      },
    ],
  });
}

function shouldShowEntryBriefing(message: string) {
  return /운영\s*브리핑|오늘\s*(업무|운영)?\s*현황|현재\s*(업무|운영)?\s*현황|운영\s*상태/.test(message);
}

function buildPartnerCandidateApprovalCard() {
  return buildStructuredMessage("ai_card_intake", {
    intakeId: "partner-candidate-a",
    category: "발주서",
    submittedBy: "채팅 입력",
    rawNote: "A거래처 추가 주문 후보로 보입니다.",
    aiExtracted: {
      fields: [
        { key: "거래처", value: "A거래처", confidence: 0.92 },
        { key: "수량", value: "3박스", confidence: 0.78 },
        { key: "희망 납기", value: "내일", confidence: 0.74 },
      ],
      missing: ["상품명"],
      avgConfidence: 0.81,
    },
    targetCanonical: "A거래처 후보",
    informationGrade: 2,
    aiUsageScope: { internalRef: true, externalSend: false, officialProcess: false },
    actions: ["accept", "ask_employee", "hold", "reject"],
  });
}

function isAutoCriteriaCommand(message: string) {
  const normalized = message.replace(/\s+/g, "");
  const hasCriteriaWord = /(자동처리|자동화|자동|기준|키워드|규칙|카테고리)/.test(normalized);
  const hasCommandWord = /(추가|등록|넣어|만들|저장|분류해|기준으로|자동처리해|승인함으로)/.test(normalized);
  return hasCriteriaWord && hasCommandWord;
}

function inferAutoCriteriaId(message: string) {
  const normalized = message.replace(/\s+/g, "").toLowerCase();

  if (/(승인함|승인|외부발송|고객발송|자동처리하지|금전|계약|환불|클레임결정|주문확정)/.test(normalized)) {
    return "approval-guard";
  }

  if (/(기록|저장|로그|상태업데이트|상태변경|태그)/.test(normalized)) {
    return "internal-record";
  }

  if (/(알림|반복|미응답|매주|재알림|follow-?up|팔로업)/.test(normalized)) {
    return "repeat-reminder";
  }

  if (/(초안|요약|보고서|개선안|문안|안내문)/.test(normalized)) {
    return "low-risk-draft";
  }

  return "internal-classification";
}

function cleanAutoCriteriaKeyword(value: string) {
  return value
    .replace(/자동\s*처리/g, " ")
    .replace(/자동화/g, " ")
    .replace(/기준/g, " ")
    .replace(/키워드/g, " ")
    .replace(/카테고리/g, " ")
    .replace(/규칙/g, " ")
    .replace(/추가해줘|추가|등록해줘|등록|넣어줘|넣어|저장해줘|저장|만들어줘|만들/g, " ")
    .replace(/\s*(으로|로|에는|에|의|을|를|은|는|이|가|좀|해줘|해|되면|경우)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
}

function extractAutoCriteriaKeywords(message: string) {
  const candidates = new Set<string>();
  const quotedPattern = /["'“”‘’]([^"'“”‘’]{1,32})["'“”‘’]/g;
  let quotedMatch: RegExpExecArray | null;

  while ((quotedMatch = quotedPattern.exec(message))) {
    const cleaned = cleanAutoCriteriaKeyword(quotedMatch[1]);
    if (cleaned) candidates.add(cleaned);
  }

  const knownPhrases = [
    "배송 문의",
    "주문 변경",
    "일반 문의",
    "미응답 분류",
    "내부 분류",
    "내부 기록",
    "기록 저장",
    "상태 업데이트",
    "태그 정리",
    "반복 알림",
    "미응답 알림",
    "재고 기준치 알림",
    "매주 확인",
    "보고서 초안",
    "요약 보고",
    "운영 개선안",
    "외부 발송",
    "고객 발송",
    "클레임 결정",
    "주문 확정",
    "환불",
    "계약",
    "금전",
  ];

  for (const phrase of knownPhrases) {
    if (message.includes(phrase)) candidates.add(phrase);
  }

  const beforeCommand = message.split(/추가|등록|넣어|저장|만들/)[0] ?? message;
  const fragments = beforeCommand.split(/[,/·]|와|과|및|그리고/);
  for (const fragment of fragments) {
    const cleaned = cleanAutoCriteriaKeyword(fragment);
    if (cleaned && cleaned.length >= 2) candidates.add(cleaned);
  }

  return [...candidates].slice(0, 6);
}

async function buildAutoCriteriaCandidateCard(message: string) {
  const criteria = await readAutoProcessingCriteria();
  const criterionId = inferAutoCriteriaId(message);
  const criterion = criteria.find((item) => item.id === criterionId) ?? criteria[0];
  const keywords = extractAutoCriteriaKeywords(message);
  const dedupedKeywords = keywords.filter(
    (keyword) => !criterion.keywords.some((item) => item.label.toLowerCase() === keyword.toLowerCase()),
  );
  const finalKeywords = dedupedKeywords.length ? dedupedKeywords : keywords;

  if (!criterion || !finalKeywords.length) {
    return asAiText("자동 처리 기준에 넣을 키워드를 찾지 못했습니다. 예: “배송 문의를 자동 처리 기준에 추가해줘”처럼 키워드를 함께 적어 주세요.");
  }

  return buildStructuredMessage("ai_card_auto_criteria", {
    criterionId: criterion.id,
    criterionTitle: criterion.title,
    autoAllowed: criterion.autoAllowed,
    keywords: finalKeywords,
    sourceText: message.slice(0, 240),
    reason: criterion.autoAllowed
      ? "사용자 요청이 고객에게 바로 발송되지 않는 내부 자동 처리 기준 추가로 판단되었습니다."
      : "사용자 요청이 자동 처리보다 승인함으로 보내야 하는 기준 추가로 판단되었습니다.",
    existingKeywords: criterion.keywords.slice(0, 8).map((keyword) => keyword.label),
    actions: ["add_auto_criteria", "hold"],
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatTaskType(taskType: string) {
  const labels: Record<string, string> = {
    order_request: "주문/발주 요청",
    quote_request: "견적 요청",
    delivery_inquiry: "배송 문의",
    payment_report: "입금 확인",
    reply_draft: "답장 초안",
    complaint: "클레임",
    automation_request: "자동화 요청",
    report_request: "보고/요약 요청",
    inventory_inquiry: "재고 확인",
    invoice_request: "계산서 발행",
    return_exchange: "반품/교환",
    order_update: "주문 변경",
    data_update: "기준정보 수정",
  };
  return labels[taskType] ?? (taskType || "업무 요청");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return value.toLocaleString("ko-KR");
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(", ");
  return String(value).trim();
}

function formatReturnedFields(fields: Record<string, unknown>) {
  return fieldLabels
    .map(([key, label]) => {
      const value = formatValue(fields[key]);
      return value ? `- ${label}: ${value}` : "";
    })
    .filter(Boolean);
}

function formatMissingFields(taskType: string, fields: Record<string, unknown>) {
  const requiredKeys = requiredFieldsByTaskType[taskType] ?? [];
  return requiredKeys
    .filter((key) => !formatValue(fields[key]))
    .map((key) => fieldLabels.find(([fieldKey]) => fieldKey === key)?.[1] ?? key);
}

function buildPipelineReply(message: string, understandingValue: unknown) {
  const understanding = asRecord(understandingValue);
  const fields = asRecord(understanding.fields);
  const taskType = asText(understanding.taskType);
  const title = asText(understanding.title) || message.slice(0, 48);
  const summary = asText(understanding.summary);
  const action = asText(understanding.recommendedAction);
  const engine = asText(understanding.engine) || "ai";
  const confidence = typeof understanding.confidence === "number" ? `${Math.round(understanding.confidence * 100)}%` : "";
  const returnedFields = formatReturnedFields(fields);
  const missingFields = formatMissingFields(taskType, fields);

  return buildStructuredMessage("ai_card_intake", {
    intakeId: `chat-intake-${Date.now()}`,
    category: taskType === "quote_request" ? "기타" : "발주서",
    submittedBy: "채팅 입력",
    rawNote: message.slice(0, 240),
    aiExtracted: {
      fields: fieldLabels
        .map(([key, label]) => {
          const value = formatValue(fields[key]);
          return value ? { key: label, value } : null;
        })
        .filter(Boolean),
      missing: missingFields,
      avgConfidence: typeof understanding.confidence === "number" ? understanding.confidence : undefined,
    },
    targetCanonical: title || formatTaskType(taskType),
    informationGrade: missingFields.length ? 3 : 2,
    aiUsageScope: { internalRef: true, externalSend: false, officialProcess: false },
    actions: missingFields.length ? ["ask_employee", "edit_then_accept", "hold", "reject"] : ["accept", "edit_then_accept", "hold", "reject"],
    summary,
    recommendedAction: action,
    confidence,
    engine: engine === "llm" ? "Groq AI" : "로컬 보조 분류",
    returnedFields,
  });
}

/** Runner 원샷 파이프라인(이해→맥락→판단) 결과를 판단에 맞는 채팅 카드로 변환 */
function buildWorkDecisionReply(message: string, work: RunnerChatWorkResponse) {
  const understanding = asRecord(work.understanding);
  const decision = asRecord(work.decision);
  const approval = asRecord(work.approval);
  const outcome = asText(decision.outcome);
  const taskId = asText(work.taskId);
  const title = asText(decision.title) || asText(understanding.title) || message.slice(0, 48);

  if (outcome === "AUTO_RUN") {
    return buildStructuredMessage("ai_card_progress", {
      taskId,
      title,
      status: "ready_to_execute",
      summary: asText(decision.reason) || asText(understanding.summary),
      action: asText(decision.action),
      priority: asText(decision.priority) || "normal",
      dueDate: asText(decision.dueDate),
      taskTypeLabel: formatTaskType(asText(understanding.taskType)),
      actions: ["execute_task", "hold"],
    });
  }

  if (outcome === "APPROVAL_REQUIRED" || outcome === "SUGGEST_ALTERNATIVE" || Object.keys(approval).length > 0) {
    const alternatives = Array.isArray(decision.suggestedAlternatives) ? decision.suggestedAlternatives : [];
    const taskType = asText(understanding.taskType);
    return buildStructuredMessage("ai_card_approval", {
      taskId,
      approvalId: asText(approval.id),
      title,
      reason: asText(decision.reason) || asText(understanding.recommendedAction),
      riskLevel: asText(decision.riskLevel) || asText(understanding.riskLevel) || "medium",
      taskTypeLabel: formatTaskType(taskType),
      // device dispatch용: 승인 시 원격 실행 에이전트로 내보낼 정보
      capability: capabilityForTaskType(taskType),
      fields: asRecord(understanding.fields),
      alternatives,
      internalReason: asText(decision.reason),
      actions: ["approve", "reject", "hold"],
    });
  }

  // BLOCKED / needs_review / 판단 실패: 되묻기 겸 검토 카드로
  return buildPipelineReply(message, work.understanding);
}

/** 업무 타입 → 원격 실행 capability (device 절차 템플릿 키) */
function capabilityForTaskType(taskType: string): string {
  const map: Record<string, string> = {
    order_request: "order.create",
    order_update: "order.update",
    quote_request: "quote.create",
    invoice_request: "invoice.create",
  };
  return map[taskType] ?? "";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function extractStructuredHistoryText(content: string) {
  try {
    const parsed = JSON.parse(content.trim()) as { type?: unknown; payload?: unknown };
    const payload = parsed.payload && typeof parsed.payload === "object" ? (parsed.payload as Record<string, unknown>) : {};

    if (parsed.type === "ai_text" && typeof payload.text === "string") {
      return payload.text;
    }

    if (parsed.type === "ai_briefing") {
      const summary = typeof payload.summary === "string" ? payload.summary : "";
      const items = Array.isArray(payload.items)
        ? payload.items
            .map((item) => {
              const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
              return [record.title, record.preview].filter((value) => typeof value === "string" && value).join(": ");
            })
            .filter(Boolean)
            .join(" / ")
        : "";
      return [summary, items].filter(Boolean).join(" ");
    }

    const title =
      typeof payload.title === "string"
        ? payload.title
        : typeof payload.targetCanonical === "string"
          ? payload.targetCanonical
          : typeof payload.summary === "string"
            ? payload.summary
            : "";
    return title ? `AI card: ${title}` : content;
  } catch {
    return content;
  }
}

function buildChatHistory(history: OperationChatMessage[] | undefined): RunnerChatHistoryMessage[] {
  return (history ?? [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: (message.role === "assistant" ? extractStructuredHistoryText(message.content) : message.content).trim().slice(0, 2500),
    }))
    .filter((message) => message.content)
    .slice(-12);
}

function localGeneralFallback(message: string, error?: unknown) {
  if (/^(안녕|안녕하세요|하이|hi|hello)\s*[!.?]*$/i.test(message.trim())) {
    return asAiText("안녕하세요. 어떤 업무를 도와드릴까요?");
  }

  if (error) {
    return asAiText([
      "일반 대화로 분류했지만 AI 응답 호출이 실패했습니다.",
      "",
      `오류: ${getErrorMessage(error)}`,
      "",
      "Runner와 Groq 연결 상태를 확인해 주세요.",
    ].join("\n"));
  }

  return asAiText("알겠습니다. 발주나 견적 요청이 아닌 일반 대화로 이해했습니다. 필요한 내용을 편하게 말씀해 주세요.");
}

function findExceptionInboxLinks(message: string) {
  const normalized = message.replace(/\s+/g, "").toLowerCase();

  return (adminSettings.exceptionInboxLinks ?? []).filter((link) => {
    if (!link.enabled) return false;
    const keyword = link.keyword.replace(/\s+/g, "").toLowerCase();
    return keyword ? normalized.includes(keyword) : false;
  });
}

function findExceptionKeywords(message: string) {
  const normalized = message.replace(/\s+/g, "").toLowerCase();
  return exceptionKeywordPresets.filter((keyword) => normalized.includes(keyword.replace(/\s+/g, "").toLowerCase()));
}

function buildExceptionInboxReply(message: string) {
  const matches = findExceptionInboxLinks(message);
  const keywords = findExceptionKeywords(message);
  if (!matches.length && !keywords.length) return null;
  const matchedKeywords = new Set(matches.map((link) => link.keyword));
  const missingKeywords = keywords.filter((keyword) => !matchedKeywords.has(keyword));

  return asAiText([
    "예외접수함 안내가 필요한 내용으로 판단했습니다.",
    "",
    matches.length ? "감지된 키워드와 연결된 접수 링크:" : "연결된 접수 링크가 아직 등록되지 않았습니다.",
    ...matches.map((link) =>
      [
        `- ${link.keyword}: ${link.url}`,
        link.description ? `  설명: ${link.description}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    missingKeywords.length ? "" : "",
    missingKeywords.length ? `링크 등록이 필요한 키워드: ${missingKeywords.join(", ")}` : "",
    "",
    "이 링크는 고객에게 안내할 수 있는 외부 접수 경로입니다. 자동 처리하기 어려운 건은 예외접수함 기준에 따라 별도 접수로 넘기는 편이 안전합니다.",
  ].filter((line) => line !== "").join("\n"));
}

async function buildGeneralReply(message: string, history?: OperationChatMessage[]) {
  try {
    const chat = await chatRunnerMessage({
      message,
      system: FLOWFIT_SINGLE_OPERATION_SYSTEM_PROMPT,
      history: buildChatHistory(history),
    });
    return normalizeAssistantContent(chat.reply);
  } catch (error) {
    console.warn("[operation-chat] general chat call failed", getErrorMessage(error));
    return localGeneralFallback(message, error);
  }
}

export async function buildAssistantContent(message: string, options: { isFirstResponse?: boolean; history?: OperationChatMessage[] } = {}) {
  if (isAutoCriteriaCommand(message)) {
    return buildAutoCriteriaCandidateCard(message);
  }

  if (isSettingsCommand(message)) {
    const settingsCard = await buildSettingsUpdateCard(message);
    if (settingsCard) return settingsCard;
  }

  if (shouldShowPartnerCandidateCard(message)) {
    return buildPartnerCandidateApprovalCard();
  }

  if (options.isFirstResponse && shouldShowEntryBriefing(message)) {
    return buildEntryBriefing(message);
  }

  const exceptionReply = buildExceptionInboxReply(message);
  if (exceptionReply) {
    return exceptionReply;
  }

  // 1) 빠른 분류(저장 없음): 일반 대화인지 업무인지 판단
  let quickUnderstanding;

  try {
    quickUnderstanding = await understandRunnerMessage({
      text: message,
      sourceName: "flowfit_chat_intent",
    });
  } catch {
    return buildGeneralReply(message, options.history);
  }

  const taskType = asText(asRecord(quickUnderstanding.understanding).taskType);

  if (generalChatTaskTypes.has(taskType)) {
    return buildGeneralReply(message, options.history);
  }

  // 2) 업무 문장: 원샷 파이프라인 (intake 저장 → 이해 → 맥락 매칭 → 판단 → 필요 시 승인 생성)
  const work = await runChatWorkPipeline({
    text: message,
    sourceName: "flowfit_chat",
  }).catch(() => null);

  if (!work || work.duplicate) {
    // 파이프라인 실패 또는 중복 접수: 이해 결과만으로 검토 카드 생성
    return buildPipelineReply(message, quickUnderstanding.understanding);
  }

  return buildWorkDecisionReply(message, work);
}
