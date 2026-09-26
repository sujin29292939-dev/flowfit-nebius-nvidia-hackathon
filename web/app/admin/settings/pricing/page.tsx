import {
  WholesaleModuleSettingsScreen,
  type WholesaleSettingsFieldSection,
} from "@/components/admin/wholesale-module-settings-screen";
import { getWholesaleSettings } from "@/lib/wholesale-settings";

export const dynamic = "force-dynamic";

const sections: WholesaleSettingsFieldSection[] = [
  {
    title: "변동 경고 기준",
    description: "단가가 얼마나 바뀌면 주의 또는 심각으로 올릴지 정합니다.",
    fields: [
      {
        key: "warningChangeRatePercent",
        label: "주의 변동률",
        helper: "이 비율 이상 바뀌면 노란 경고로 올립니다.",
        type: "number",
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        key: "criticalChangeRatePercent",
        label: "심각 변동률",
        helper: "이 비율 이상 바뀌면 즉시 확인 대상으로 올립니다.",
        type: "number",
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        key: "impactedPartnerThreshold",
        label: "단가 변경 영향 거래처 수",
        helper: "단가 변경의 영향을 받는 거래처가 이 수 이상이면 우선순위를 높입니다.",
        type: "number",
        min: 1,
        unit: "곳",
      },
      {
        key: "defaultNoticeLeadDays",
        label: "거래처 안내 초안 사전 생성일",
        helper: "실제 단가 적용일보다 며칠 먼저 거래처 안내 초안을 만들지 정합니다.",
        type: "number",
        min: 0,
        unit: "일",
      },
    ],
  },
  {
    title: "거래처별 룰, 고객 안내 자동 생성 방식 설정",
    description: "거래처별 에이전트의 규칙과 업로드 방식, 거래처의 안내서 생성을 정합니다.",
    fields: [
      {
        key: "enablePartnerSpecificRules",
        label: "거래처별 개별, 예외 단가 규칙 사용",
        helper: "거래처별 개별 단가, 예외 단가를 에이전트가 사용할 수 있게 합니다.",
        type: "checkbox",
      },
      {
        key: "autoCreatePriceNotice",
        label: "거래처용 가격 안내 초안 자동 준비",
        helper: "가격 변경 가능성이 크다고 판단된 경우 거래처용 안내문을 만듭니다.",
        type: "checkbox",
      },
      {
        key: "alertChannels",
        label: "기본 알림 채널",
        helper: "단가 변동 신호를 사용자님의 어떤 앱으로 보낼지 설정합니다.",
        type: "checkbox-group",
        options: [
          { label: "앱 내 대시보드", value: "dashboard" },
          { label: "카카오톡", value: "kakao" },
          { label: "이메일", value: "email" },
          { label: "슬랙", value: "slack" },
        ],
      },
      {
        key: "allowedFileTypes",
        label: "허용된 파일 읽기 형식",
        helper: "단가표를 읽을 때 우선 받는 파일 형식입니다.",
        type: "checkbox-group",
        options: [
          { label: "Excel (.xlsx)", value: "xlsx" },
          { label: "CSV (.csv)", value: "csv" },
          { label: "PDF (.pdf)", value: "pdf" },
        ],
      },
    ],
  },
];

export default async function PricingSettingsPage() {
  const settings = await getWholesaleSettings();

  return (
    <WholesaleModuleSettingsScreen
      module="pricing"
      title="단가표 설정"
      description="단가 변동을 언제 위험으로 보고, 어떤 파일과 채널로 다룰지 정하는 화면입니다."
      updatedAt={settings.updatedAt}
      initialValues={settings.pricing}
      highlights={[
        {
          label: "주의 변동률",
          value: `${settings.pricing.warningChangeRatePercent}%`,
          note: "이 비율 이상 바뀌면 노란 경고로 올립니다.",
        },
        {
          label: "심각 변동률",
          value: `${settings.pricing.criticalChangeRatePercent}%`,
          note: "심각 변동이 높을 경우 확인 카드로 사용자님에게 띄웁니다.",
        },
        {
          label: "허용 파일 형식",
          value: settings.pricing.allowedFileTypes.join(" / "),
          note: "현재 에이전트가 읽도록 열어둔 허용 파일 형식입니다.",
        },
      ]}
      sections={sections}
    />
  );
}
