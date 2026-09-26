import {
  WholesaleModuleSettingsScreen,
  type WholesaleSettingsFieldSection,
} from "@/components/admin/wholesale-module-settings-screen";
import { getWholesaleSettings } from "@/lib/wholesale-settings";

export const dynamic = "force-dynamic";

const sections: WholesaleSettingsFieldSection[] = [
  {
    title: "납기일 전 사전 알림 기준",
    description: "납기일 전 언제 에이전트가 확인하고 어느 단계까지 초안을 생성할지 정합니다.",
    fields: [
      {
        key: "enableD3Alerts",
        label: "D-3 알림 사용",
        helper: "납기일로부터 3일전 선제 확인 카드에 올립니다.",
        type: "checkbox",
      },
      {
        key: "enableD1Alerts",
        label: "D-1 알림 사용",
        helper: "납기일로부터 하루 전 다시 올립니다.",
        type: "checkbox",
      },
      {
        key: "enableDelayAlerts",
        label: "지연 알림 사용",
        helper: "이미 늦어진 건을 별도 지연 경고로 추가합니다.",
        type: "checkbox",
      },
      {
        key: "delayThresholdDays",
        label: "지연 판정 일수",
        helper: "납기일로부터 몇일부터 지연일로 볼지 정합니다.",
        type: "number",
        min: 0,
        unit: "일",
      },
    ],
  },
  {
    title: "에스컬레이션",
    description: "거래처별 에이전트규칙과 에이전트가 담당자를 호출하는 시점을 정합니다.",
    fields: [
      {
        key: "perPartnerRulesEnabled",
        label: "거래처별 개별 규칙 사용",
        helper: "주요 거래처별로 에이전트가 더 촘촘한 납기 기준을 둘 수 있게 합니다.",
        type: "checkbox",
      },
      {
        key: "managerEscalationHours",
        label: "담당자 재확인 시간",
        helper: "한번 지연된 건을 몇 시간 뒤에 담당자에게 확인 요청할지 설정합니다.",
        type: "number",
        min: 1,
        unit: "시간",
        unitIcon: "clock",
      },
      {
        key: "alertChannels",
        label: "지연 알림 앱 설정",
        helper: "지연건이 올라오면 사용자님의 어느 앱으로 알릴지 설정합니다.",
        type: "checkbox-group",
        options: [
          { label: "앱 내 대시보드", value: "dashboard" },
          { label: "카카오톡", value: "kakao" },
          { label: "이메일", value: "email" },
          { label: "슬랙", value: "slack" },
        ],
      },
      {
        key: "autoCreateDelayNotice",
        label: "거래처 지연시 안내 초안 자동 생성",
        helper: "지연시 사람이 확인 후 바로 보낼 수 있게 고객 안내문 초안을 함께 만듭니다.",
        type: "checkbox",
      },
    ],
  },
];

export default async function DeliverySettingsPage() {
  const settings = await getWholesaleSettings();

  return (
    <WholesaleModuleSettingsScreen
      module="delivery"
      title="납기 설정"
      description="상품 출고 전 오는 알림과 납기 부문의 지연 대응(납기 시작일로부터)을 설정합니다."
      updatedAt={settings.updatedAt}
      initialValues={settings.delivery}
      highlights={[
        {
          label: "납기 전 선제 알림일",
          value: `${settings.delivery.enableD3Alerts ? "D-3" : "-"} / ${settings.delivery.enableD1Alerts ? "D-1" : "-"}`,
          note: "납기일 전에 오는 알림을 해당일로부터 며칠 전까지 사용하는지 보여줍니다.",
        },
        {
          label: "납기일로부터 지연 판정일",
          value: `${settings.delivery.delayThresholdDays}일`,
          note: "납기일로부터 해당 다음일까지의 기준을 넘기면 지연위험 카드로 노출됩니다.",
        },
        {
          label: "담당자 재호출",
          value: `${settings.delivery.managerEscalationHours}시간`,
          note: "여기서의 담당자는 회사 내의 직원을 의미합니다.",
        },
      ]}
      sections={sections}
    />
  );
}
