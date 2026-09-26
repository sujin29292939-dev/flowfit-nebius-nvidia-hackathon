// understanding/heuristics.ts
// Deterministic fallback parser for core FlowFit MVP task types.

import { standardizeBusinessFields } from "./dateStandardizer.js";
import type {
  BusinessRiskLevel,
  BusinessTaskType,
  ExtractedBusinessFields,
  TaskUnderstandingResult,
  UnderstandingInput,
} from "./types.js";

const KEYWORDS: Record<BusinessTaskType, RegExp[]> = {
  order_request: [/주문|발주|추가\s*주문|더\s*달라|접수|구매/i],
  quote_request: [/견적|단가|가격|견적서|얼마/i],
  delivery_inquiry: [/배송|출고|송장|택배|납기|도착|지연|주소\s*변경/i],
  payment_report: [/입금|결제|영수증|세금계산서|송금|미수/i],
  reply_draft: [/답장|문자|메일|안내문|초안|회신/i],
  complaint: [/클레임|불만|항의|화냄|화가|환불|취소|늦는다고/i],
  automation_request: [/자동화|매일|반복|예약|정기|규칙/i],
  report_request: [/보고|정리|리포트|요약|현황/i],
  inventory_inquiry: [/재고|입고|보유|몇\s*개\s*남|남았|남아|stock/i],
  invoice_request: [/세금\s*계산서|계산서|인보이스|invoice/i, /발행|끊어|발급/i],
  return_exchange: [/반품|교환|회수|불량|return|exchange/i],
  order_update: [/주문|발주|수량|납기|배송일/i, /변경|수정|취소|연기|미뤄|바꿔/i],
  data_update: [/단가|연락처|담당자|마스터|기준\s*정보|거래처\s*정보/i, /변경|수정|등록|업데이트|갱신/i],
  general_request: [/확인|처리|알려|도와/i],
  unknown: [],
};

const REQUIRED_FIELDS: Partial<Record<BusinessTaskType, Array<keyof ExtractedBusinessFields>>> = {
  order_request: ["customerName", "itemName", "quantity"],
  quote_request: ["customerName", "itemName", "quantity"],
  delivery_inquiry: ["customerName"],
  payment_report: ["customerName", "amount"],
  inventory_inquiry: ["itemName"],
  invoice_request: ["customerName"],
  return_exchange: ["customerName", "itemName"],
  order_update: ["customerName"],
};

export function heuristicUnderstand(input: UnderstandingInput): TaskUnderstandingResult {
  const rawText = input.rawText.trim();
  const taskType = detectTaskType(rawText);
  const fields = standardizeBusinessFields(extractFields(rawText, taskType), rawText, input.receivedAt);
  const missingFields = findMissingFields(taskType, fields);
  const riskLevel = detectRiskLevel(taskType, rawText, fields, missingFields);
  const needsHumanReview = missingFields.length > 0 || riskLevel === "high" || riskLevel === "uncertain";
  const confidence = estimateConfidence(taskType, fields, missingFields);

  return {
    taskType,
    title: buildTitle(taskType, fields, rawText),
    summary: buildSummary(taskType, fields, rawText),
    fields,
    missingFields,
    confidence,
    riskLevel,
    recommendedAction: buildRecommendedAction(taskType, missingFields, riskLevel, fields),
    evidence: buildEvidence(rawText, fields),
    needsHumanReview,
    engine: "heuristic",
  };
}

function detectTaskType(text: string): BusinessTaskType {
  const scores = Object.entries(KEYWORDS)
    .filter(([type]) => type !== "unknown")
    .map(([type, patterns]) => ({
      type: type as BusinessTaskType,
      score: patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scores[0];
  if (!best || best.score <= 0) return "general_request";
  return best.type;
}

function extractFields(text: string, taskType: BusinessTaskType): ExtractedBusinessFields {
  const amount = extractAmount(text);
  const quantity = text.match(/(\d{1,5})\s*(박스|box|개|건|세트|ea|kg|병|포|장)/i);
  const customerName = extractCustomerName(text);
  const itemName = extractItemName(text, quantity?.index ?? -1);

  return {
    customerName,
    itemName,
    quantity: quantity ? Number(quantity[1]) : undefined,
    unit: quantity?.[2],
    amount,
    orderNumber: firstMatch(text, /(?:주문번호|오더번호|order\s*no\.?)\s*[:#]?\s*([A-Za-z0-9-]+)/i),
    trackingNumber: firstMatch(text, /(?:송장|운송장|tracking)\s*[:#]?\s*([A-Za-z0-9-]+)/i),
    depositorName: firstMatch(text, /(?:입금자|예금주)\s*[:\s]\s*([가-힣A-Za-z0-9]{2,20})/),
    requestedReplyChannel: detectReplyChannel(text, taskType),
  };
}

function extractCustomerName(text: string) {
  return (
    firstMatch(text, /(?:거래처|고객|업체|회사)\s*[:\s]\s*([가-힣A-Za-z0-9&.\-\s]{2,30})/) ??
    firstMatch(text, /([가-힣A-Za-z0-9&.\-]{1,24}(?:상사|유통|물산|마트|거래처|컴퍼니|회사|식품|몰))/) ??
    firstMatch(text, /([A-Z][A-Za-z0-9&.\-]{1,24})\s*(?:에서|가|은|는)/)
  )?.trim();
}

function extractItemName(text: string, quantityIndex: number) {
  const labeled =
    firstMatch(text, /(?:품목|상품|제품|물품|아이템)\s*[:\s]\s*([가-힣A-Za-z0-9_\-\s]{1,30})/) ??
    firstMatch(text, /([A-Za-z가-힣0-9_\-]{1,24}\s*(?:품목|상품|제품|대형|소형|박스형))/);
  if (labeled) return labeled.trim();

  if (quantityIndex > 0) {
    const beforeQuantity = text.slice(0, quantityIndex).trim();
    const tokens = beforeQuantity.split(/\s+/).filter(Boolean);
    const candidate = tokens.at(-1);
    if (candidate && !/(거래처|상사|유통|마트|회사)$/.test(candidate)) return candidate;
  }

  return undefined;
}

function extractAmount(text: string) {
  const won = text.match(/(\d[\d,]*)\s*(원|만원)/);
  if (!won) return undefined;
  const base = Number(won[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return undefined;
  return won[2] === "만원" ? base * 10_000 : base;
}

function findMissingFields(taskType: BusinessTaskType, fields: ExtractedBusinessFields) {
  const required = REQUIRED_FIELDS[taskType] ?? [];
  return required
    .filter((field) => fields[field] === undefined || fields[field] === "")
    .map((field) => fieldLabel(field));
}

function detectRiskLevel(
  taskType: BusinessTaskType,
  text: string,
  fields: ExtractedBusinessFields,
  missingFields: string[],
): BusinessRiskLevel {
  if (/환불|취소|송금|계약|세금계산서/.test(text)) return "high";
  if (taskType === "complaint") return "high";
  if (missingFields.length > 0) return "uncertain";
  if ((fields.amount ?? 0) >= 500_000) return "high";
  if (taskType === "payment_report") return "medium";
  if (taskType === "reply_draft" || taskType === "delivery_inquiry") return "medium";
  return "low";
}

function estimateConfidence(
  taskType: BusinessTaskType,
  fields: ExtractedBusinessFields,
  missingFields: string[],
) {
  let confidence = taskType === "general_request" ? 0.55 : 0.72;
  if (fields.customerName) confidence += 0.08;
  if (fields.itemName) confidence += 0.08;
  if (fields.quantity) confidence += 0.06;
  if (fields.dueDate) confidence += 0.04;
  confidence -= missingFields.length * 0.12;
  return Math.max(0.2, Math.min(0.95, Number(confidence.toFixed(2))));
}

function buildTitle(taskType: BusinessTaskType, fields: ExtractedBusinessFields, text: string) {
  const customer = fields.customerName ? `${fields.customerName} ` : "";
  const item = fields.itemName ? `${fields.itemName} ` : "";
  const fallback = text.length > 30 ? `${text.slice(0, 30)}...` : text;

  switch (taskType) {
    case "order_request": return `${customer}${item}주문 요청`.trim();
    case "quote_request": return `${customer}${item}견적 요청`.trim();
    case "delivery_inquiry": return `${customer}배송 확인 요청`.trim();
    case "payment_report": return `${customer}입금 확인 요청`.trim();
    case "complaint": return `${customer}클레임 확인`.trim();
    case "automation_request": return "자동화 요청";
    case "report_request": return "운영 보고 요청";
    case "reply_draft": return "답장 초안 요청";
    case "inventory_inquiry": return `${item}재고 확인`.trim();
    case "invoice_request": return `${customer}계산서 발행 요청`.trim();
    case "return_exchange": return `${customer}${item}반품/교환 처리`.trim();
    case "order_update": return `${customer}주문 변경 요청`.trim();
    case "data_update": return "기준정보 수정 요청";
    default: return fallback || "일반 요청";
  }
}

function buildSummary(taskType: BusinessTaskType, fields: ExtractedBusinessFields, text: string) {
  const parts = [
    taskLabel(taskType),
    fields.customerName ? `거래처: ${fields.customerName}` : undefined,
    fields.itemName ? `품목: ${fields.itemName}` : undefined,
    fields.quantity ? `수량: ${fields.quantity}${fields.unit ?? ""}` : undefined,
    fields.dueDateText ? `기한: ${fields.dueDateText}` : undefined,
  ].filter(Boolean);

  return parts.length > 1 ? parts.join(" / ") : text;
}

function buildRecommendedAction(
  taskType: BusinessTaskType,
  missingFields: string[],
  riskLevel: BusinessRiskLevel,
  fields: ExtractedBusinessFields,
) {
  if (missingFields.length > 0) return `부족 정보 확인: ${missingFields.join(", ")}`;
  if (riskLevel === "high") return "대표 승인 후 처리";
  if (taskType === "order_request") return fields.priority === "high" || fields.priority === "urgent"
    ? "우선 재고 확인 후 주문 처리"
    : "재고 확인 후 주문 처리";
  if (taskType === "quote_request") return "단가 확인 후 견적 초안 생성";
  if (taskType === "delivery_inquiry") return "배송 상태 확인 후 답장 초안 생성";
  if (taskType === "payment_report") return "입금 내역 대조 후 확인 요청";
  return "AI 작업 승인함에 검토 카드 생성";
}

function buildEvidence(text: string, fields: ExtractedBusinessFields) {
  const evidence = [`원문: ${text.slice(0, 120)}`];
  if (fields.priority) evidence.push(`우선순위 표준화: ${fields.priority}`);
  if (fields.dueDate) evidence.push(`마감 표준화: ${fields.dueDate}`);
  return evidence;
}

function detectReplyChannel(text: string, taskType: BusinessTaskType) {
  if (/문자|sms/i.test(text)) return "sms";
  if (/메일|이메일|email/i.test(text)) return "email";
  if (/카카오|카톡|kakao/i.test(text)) return "kakao";
  if (taskType === "delivery_inquiry" || taskType === "reply_draft") return "sms";
  return undefined;
}

function taskLabel(taskType: BusinessTaskType) {
  const labels: Record<BusinessTaskType, string> = {
    order_request: "주문 요청",
    quote_request: "견적 요청",
    delivery_inquiry: "배송 문의",
    payment_report: "입금 보고",
    reply_draft: "답장 초안",
    complaint: "클레임",
    automation_request: "자동화 요청",
    report_request: "보고 요청",
    inventory_inquiry: "재고 확인",
    invoice_request: "계산서 발행",
    return_exchange: "반품/교환",
    order_update: "주문 변경",
    data_update: "기준정보 수정",
    general_request: "일반 요청",
    unknown: "알 수 없음",
  };
  return labels[taskType];
}

function fieldLabel(field: keyof ExtractedBusinessFields) {
  const labels: Partial<Record<keyof ExtractedBusinessFields, string>> = {
    customerName: "거래처명",
    itemName: "품목명",
    quantity: "수량",
    amount: "금액",
    deliveryAddress: "배송지",
  };
  return labels[field] ?? String(field);
}

function firstMatch(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1];
}
