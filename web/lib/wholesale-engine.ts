const LOCAL_ENGINE_BASE_URL =
  process.env.FLOWFIT_MOBILE_ENGINE_BASE_URL ||
  process.env.FLOWFIT_ENGINE_BASE_URL ||
  "http://127.0.0.1:3001";

export type PurchaseOrder = {
  id: string;
  partner_id: string | number | null;
  partnerName: string;
  items: string[];
  total_amount: number;
  order_date: string | null;
  due_date: string | null;
  status: string;
  source: string;
};

export type Receivable = {
  id: string;
  partner_id: string | number | null;
  partnerName: string;
  invoice_id: string;
  amount: number;
  due_date: string | null;
  overdue_days: number;
  status: string;
};

export type PriceHistory = {
  id: string;
  item_code: string;
  item_name: string;
  old_price: number;
  new_price: number;
  changed_at: string | null;
  affectedPartnerNames: string[];
  average_monthly_volume: number;
  changeRate: number;
  expectedMonthlyDelta: number;
};

export type Claim = {
  id: string;
  partnerName: string;
  type: string;
  amount: number;
  received_at: string | null;
  status: string;
  reason: string;
};

export type PipelineStage =
  | "견적 요청"
  | "발주 확인"
  | "분납 진행 중"
  | "결제 대기"
  | "정산 완료";

export type PipelineTimelineItem = {
  id: string;
  type: "발주" | "입금" | "견적" | "반품" | "통화" | "방문" | "문자" | "AI처리" | "이상";
  title: string;
  detail: string;
  at: string;
};

export type PipelineCard = {
  id: string;
  partnerId: string;
  partnerName: string;
  orderId: string;
  title: string;
  stage: PipelineStage;
  totalAmount: number;
  dueDate: string;
  dDay: number;
  managerName: string;
  managerInitials: string;
  receivableAmount: number;
  receivableOverdueDays: number;
  priceVersion: string;
  paymentTerms: string;
  splitSchedule: string;
  aiInsight: string;
  lastContactDays: number;
  idleDays: number;
  timeline: PipelineTimelineItem[];
};

export type QuoteBuilderProduct = {
  id: string;
  itemCode: string;
  itemName: string;
  unitPrice: number;
  unit: string;
  vatIncluded: boolean;
};

export type QuoteBuilderPartner = {
  id: string;
  name: string;
  paymentTerms: string;
  returnPolicy: string;
  manager: string;
  preferredPriceVersion: string;
  recommendedItems: string[];
};

async function readEngineJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${LOCAL_ENGINE_BASE_URL}${path}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function orderStatusLabel(status: string) {
  switch (status) {
    case "draft":
      return "초안";
    case "registered":
      return "등록됨";
    case "waiting_shipment":
      return "납기 D-3";
    case "shipped":
      return "출고 완료";
    case "completed":
      return "완료";
    case "cancelled":
      return "취소";
    case "delayed":
      return "지연 위험";
    default:
      return status || "미확인";
  }
}

function receivableStatusLabel(status: string, overdueDays: number) {
  if (status === "paid") return "완료";
  if (status === "disputed") return "분쟁";
  if (status === "ignored") return "무시";
  if (overdueDays >= 60) return "60일 초과";
  if (overdueDays >= 30) return "30일 초과";
  if (status === "due_soon") return "D-3";
  return "예정";
}

function sourceLabel(source: string) {
  const map: Record<string, string> = {
    manual_paste: "직접 입력",
    file_upload: "파일 업로드",
    email: "이메일",
    gmail: "Gmail",
    outlook: "Outlook",
    mobile_notification: "모바일 알림",
    kakao: "카카오",
    sms: "문자",
    system_cron: "자동 실행",
  };

  return map[source] || source || "미확인";
}

export function formatWonMan(value: number) {
  const absolute = Math.abs(value);
  if (absolute < 10000) {
    return `₩${new Intl.NumberFormat("ko-KR").format(value)}`;
  }

  return `₩${new Intl.NumberFormat("ko-KR").format(Math.round(value / 10000))}만`;
}

export function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(0)}%`;
}

export function formatDayDelta(value: number) {
  if (value === 0) return "D-Day";
  return value > 0 ? `D+${value}` : `D${value}`;
}

export async function getWholesaleOrders() {
  const payload = await readEngineJson<{ rows: Array<any> }>("/v1/wholesale/orders");
  const rows = payload?.rows ?? [];

  return rows.map((row) => ({
    id: String(row.id),
    partner_id: row.partner_id ?? null,
    partnerName: row.partner_name || "미확인 거래처",
    items: Array.isArray(row.items) ? row.items : [],
    total_amount: Number(row.total_amount || 0),
    order_date: row.order_date || null,
    due_date: row.due_date || null,
    status: orderStatusLabel(String(row.status || "")),
    source: sourceLabel(String(row.source || "")),
  })) as PurchaseOrder[];
}

export async function getWholesaleReceivables() {
  const payload = await readEngineJson<{
    summary: {
      total: number;
      over30: number;
      over60: number;
    };
    rows: Array<any>;
  }>("/v1/wholesale/receivables");

  const rows = payload?.rows ?? [];

  return {
    summary: payload?.summary ?? {
      total: 0,
      over30: 0,
      over60: 0,
    },
    rows: rows.map((row) => ({
      id: String(row.id),
      partner_id: row.partner_id ?? null,
      partnerName: row.partner_name || "미확인 거래처",
      invoice_id: row.invoice_id || `AR-${row.id}`,
      amount: Number(row.amount || 0),
      due_date: row.due_date || null,
      overdue_days: Number(row.overdue_days || 0),
      status: receivableStatusLabel(String(row.status || ""), Number(row.overdue_days || 0)),
    })) as Receivable[],
  };
}

export async function getWholesalePriceHistory() {
  const payload = await readEngineJson<{ rows: Array<any> }>("/v1/wholesale/price-history");
  const rows = payload?.rows ?? [];

  return rows.map((row) => ({
    id: String(row.id),
    item_code: row.item_code || `ITEM-${row.item_id ?? row.id}`,
    item_name: row.item_name || "미확인 품목",
    old_price: Number(row.old_price || 0),
    new_price: Number(row.new_price || 0),
    changed_at: row.changed_at || null,
    affectedPartnerNames: Array.isArray(row.affected_partner_names) ? row.affected_partner_names : [],
    average_monthly_volume: Number(row.average_monthly_volume || 0),
    changeRate: Number(row.change_rate || 0),
    expectedMonthlyDelta: Number(row.expected_monthly_delta || 0),
  })) as PriceHistory[];
}

export async function getWholesaleClaims() {
  const payload = await readEngineJson<{ rows: Array<any> }>("/v1/wholesale/claims");
  const rows = payload?.rows ?? [];

  return rows.map((row) => ({
    id: String(row.id),
    partnerName: row.partner_name || "미확인 거래처",
    type: row.type || "미분류",
    amount: Number(row.amount || 0),
    received_at: row.received_at || null,
    status: row.status || "미확인",
    reason: row.reason || "",
  })) as Claim[];
}

export async function getWholesalePipelineBoard() {
  const payload = await readEngineJson<{
    columns: PipelineStage[];
    cards: PipelineCard[];
  }>("/v1/wholesale/pipeline");

  return (
    payload ?? {
      columns: ["견적 요청", "발주 확인", "분납 진행 중", "결제 대기", "정산 완료"],
      cards: [],
    }
  );
}

export async function getWholesaleQuoteBuilderData() {
  const payload = await readEngineJson<{
    partners: QuoteBuilderPartner[];
    products: QuoteBuilderProduct[];
  }>("/v1/wholesale/quote-builder");

  return payload ?? { partners: [], products: [] };
}

export async function getWholesaleAutomationTriggers() {
  return [
    "이메일로 발주서 수신됨",
    "문자로 문의 수신됨",
    "미수금이 30일 초과",
    "미수금이 60일 초과",
    "납기일 3일 전",
    "단가표 업데이트됨",
    "반품 요청 3건 누적",
    "거래처 발주 전월 대비 30% 이상 감소",
  ];
}
