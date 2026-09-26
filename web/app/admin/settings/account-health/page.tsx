import {
  WholesaleModuleSettingsScreen,
  type WholesaleSettingsFieldSection,
} from "@/components/admin/wholesale-module-settings-screen";
import { getWholesaleSettings } from "@/lib/wholesale-settings";

export const dynamic = "force-dynamic";

const sections: WholesaleSettingsFieldSection[] = [
  {
    title: "거래처 RFM 비중",
    description: "거래처 건강 점수에서 최근성, 빈도, 금액 비중을 얼마나 둘지 정합니다.",
    fields: [
      {
        key: "recencyWeight",
        label: "최근성 비중",
        helper: "이 비중은 퍼센트 기준입니다. 오랫동안 주문이 없는 거래처를 얼마나 민감하게 볼지 정합니다.",
        type: "number",
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        key: "frequencyWeight",
        label: "빈도 비중",
        helper: "거래처 주문 횟수 변화가 건강 점수에 주는 영향을 정합니다.",
        type: "number",
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        key: "monetaryWeight",
        label: "거래 금액 비중",
        helper: "거래 금액 감소를 어느 정도의 값으로 볼지 정합니다.",
        type: "number",
        min: 0,
        max: 100,
        unit: "%",
      },
    ],
  },
  {
    title: "이상 징후 기준점",
    description: "경고단계로 확인 할 점수, 심각 단계로 볼 점수, 발주 감소율을 확인하는 기준을 설정합니다.",
    fields: [
      {
        key: "warningScoreCutoff",
        label: "주의 점수 하향 기준",
        helper: "해당 점수 이하부터 경고를 올립니다.",
        type: "number",
        min: 0,
        max: 100,
        unit: "점",
      },
      {
        key: "criticalScoreCutoff",
        label: "심각 점수 하향 기준",
        helper: "해당 점수 이하부터 강한 이탈 위험으로 봅니다.",
        type: "number",
        min: 0,
        max: 100,
        unit: "점",
      },
      {
        key: "orderDropThresholdPercent",
        label: "월별 발주 감소율 기준",
        helper: "전월 대비 이 비율 이상 줄면 이상 거래처로 먼저 올립니다.",
        type: "number",
        min: 0,
        max: 100,
        unit: "%",
      },
      {
        key: "noOrderDaysThreshold",
        label: "무발주 일수 기준",
        helper: "이 기간 동안 주문이 없으면 참고 신호로 올립니다.",
        type: "number",
        min: 1,
        unit: "일",
      },
      {
        key: "alertChannels",
        label: "거래처 건강 알림 앱 설정",
        helper: "거래처 건강에 이상 징후가 올라오면 사용자님의 어느 앱으로 알릴지 설정합니다.",
        type: "checkbox-group",
        options: [
          { label: "앱 내 대시보드", value: "dashboard" },
          { label: "카카오톡", value: "kakao" },
          { label: "이메일", value: "email" },
          { label: "슬랙", value: "slack" },
        ],
      },
    ],
  },
];

export default async function AccountHealthSettingsPage() {
  const settings = await getWholesaleSettings();

  return (
    <WholesaleModuleSettingsScreen
      module="account-health"
      title="거래처의 건강판단 설정"
      description="거래처 이탈 징후를 얼마나 빨리, 어떤 기준으로 잡을지 정하는 화면입니다."
      updatedAt={settings.updatedAt}
      initialValues={settings.accountHealth}
      highlights={[
        {
          label: "거래처 현재 R/F/M",
          value: `${settings.accountHealth.recencyWeight}/${settings.accountHealth.frequencyWeight}/${settings.accountHealth.monetaryWeight}`,
          note: "거래처의 최근성 빈도 금액 비중을 나타냅니다.",
        },
        {
          label: "거래처 주의 점수",
          value: `${settings.accountHealth.warningScoreCutoff}점`,
          note: "해당 점수 이하부터 경고를 올립니다.",
        },
        {
          label: "발주량 감소 기준",
          value: `${settings.accountHealth.orderDropThresholdPercent}%`,
          note: "전월 대비 발주량 감소율이 이 기준을 넘으면 이상 신호로 올립니다.",
        },
      ]}
      sections={sections}
    />
  );
}
