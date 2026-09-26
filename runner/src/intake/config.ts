// intake/config.ts
// DB 연결 없이도 쓸 수 있는 Intake 기본 설정.

export const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID ?? "company_demo";
export const DEFAULT_COMPANY_NAME = process.env.DEFAULT_COMPANY_NAME ?? "FlowFit Demo Company";

export function getDefaultCompanyId() {
  return DEFAULT_COMPANY_ID;
}
