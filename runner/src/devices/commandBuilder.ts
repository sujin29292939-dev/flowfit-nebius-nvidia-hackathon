// devices/commandBuilder.ts
// 결정된 업무(task)를 웹 ERP 조작 절차(device command steps)로 변환한다.
//
// 절차 템플릿(ProcedureTemplate)이 "FlowFit 표준 필드 → ERP 화면 위치·조작"을 정의하고,
// 빌더는 task의 실제 값을 채워 구체적인 스텝을 만든다.
// 이 템플릿이 곧 절차 데이터셋의 최소 단위이며, 회사×업무×ERP 별로 늘어난다.

import type { DeviceCommandStep } from "./types.js";

/** 절차 스텝 정의. field가 있으면 task 값으로 치환한다. */
export interface ProcedureStepTemplate {
  op: string;
  /** ERP 화면의 대상 지시자(셀렉터·URL·필드명). {value}는 없음 */
  target?: string;
  /** 이 스텝에 채울 task 필드 키 (없으면 정적 스텝) */
  field?: string;
  /** 성공 검증 방법 */
  verify?: string;
  /** field 값이 없을 때 스텝을 건너뛸지 (선택 필드) */
  optional?: boolean;
}

export interface ProcedureTemplate {
  key: string;             // 예: "weberp_demo:order.create"
  erpKey: string;          // 대상 ERP 식별자
  capability: string;      // 매핑되는 capability
  baseUrl: string;         // 조작 대상 웹 ERP URL
  steps: ProcedureStepTemplate[];
  /** 값이 반드시 있어야 하는 필드 (없으면 빌드 실패 → 되묻기) */
  requiredFields: string[];
}

export interface BuildResult {
  ok: true;
  steps: DeviceCommandStep[];
  capability: string;
}
export interface BuildError {
  ok: false;
  error: string;
  missingFields: string[];
}

/** task에서 필드 값을 문자열로 뽑는다. */
function fieldValue(fields: Record<string, unknown>, key: string): string | undefined {
  const v = fields[key];
  if (v === undefined || v === null || v === "") return undefined;
  return String(v);
}

/**
 * 절차 템플릿 + task 필드 → 구체적 device 명령 스텝.
 * 필수 필드가 비면 빌드하지 않고 missingFields를 돌려준다(되묻기 유도).
 */
export function buildDeviceCommand(input: {
  template: ProcedureTemplate;
  fields: Record<string, unknown>;
}): BuildResult | BuildError {
  const { template, fields } = input;

  const missing = template.requiredFields.filter((key) => fieldValue(fields, key) === undefined);
  if (missing.length > 0) {
    return { ok: false, error: "missing_required_fields", missingFields: missing };
  }

  const steps: DeviceCommandStep[] = [];
  for (const st of template.steps) {
    if (st.field) {
      const value = fieldValue(fields, st.field);
      if (value === undefined) {
        if (st.optional) continue;
        return { ok: false, error: `missing_field:${st.field}`, missingFields: [st.field] };
      }
      steps.push({ op: st.op, target: st.target, value, verify: st.verify });
    } else {
      // 정적 스텝: NAVIGATE, SUBMIT 등. target에 {baseUrl} 치환 지원
      const target = st.target?.replace("{baseUrl}", template.baseUrl);
      steps.push({ op: st.op, target, verify: st.verify });
    }
  }

  return { ok: true, steps, capability: template.capability };
}

// ──────────────────────────────────────────────────────
// MVP 절차 템플릿: 데모 웹 ERP의 신규 주문 등록(order.create)
// 실제 회사 도입 시 이 템플릿을 절차 데이터셋(관찰→승격)으로 대체한다.
// ──────────────────────────────────────────────────────
export const DEMO_WEBERP_ORDER_CREATE: ProcedureTemplate = {
  key: "weberp_demo:order.create",
  erpKey: "weberp_demo",
  capability: "order.create",
  baseUrl: process.env.DEMO_WEBERP_URL ?? "https://demo-erp.flowfit.local/orders/new",
  requiredFields: ["customerName", "itemName", "quantity"],
  steps: [
    { op: "NAVIGATE", target: "{baseUrl}", verify: "url_contains:/orders/new" },
    { op: "TYPE", target: "#customer", field: "customerName", verify: "value_set:#customer" },
    { op: "TYPE", target: "#item", field: "itemName", verify: "value_set:#item" },
    { op: "TYPE", target: "#qty", field: "quantity", verify: "value_set:#qty" },
    { op: "TYPE", target: "#due", field: "dueDate", optional: true },
    { op: "TYPE", target: "#memo", field: "deliveryAddress", optional: true },
    { op: "SUBMIT", target: "#order-form", verify: "toast_contains:주문 등록 완료" },
  ],
};

const TEMPLATES: Record<string, ProcedureTemplate> = {
  "order.create": DEMO_WEBERP_ORDER_CREATE,
};

/** capability에 맞는 절차 템플릿을 찾는다(회사별 확장 지점). */
export function findProcedureTemplate(capability: string): ProcedureTemplate | null {
  return TEMPLATES[capability] ?? null;
}
