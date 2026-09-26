import {
  WholesaleModuleSettingsScreen,
  type WholesaleSettingsFieldSection,
} from "@/components/admin/wholesale-module-settings-screen";
import { getWholesaleSettings } from "@/lib/wholesale-settings";
import { formatWonMan } from "@/lib/wholesale-engine";

export const dynamic = "force-dynamic";

const sections: WholesaleSettingsFieldSection[] = [
  {
    title: "위험 기준",
    description: "고액 미수금과 지연 일수를 어느 지점에서 P1로 올릴지 정합니다.",
    fields: [
      {
        key: "p1AmountThreshold",
        label: "P1(1순위로 확인) 미수 알림 금액 설정",
        helper: "연체 시작일로부터 미수 금액이 특정 금액을 넘으면 알림이 오도록, 연체 알림 시작 금액을 설정합니다.",
        type: "number",
        min: 0,
        step: 100000,
      },
      {
        key: "p1OverdueDays",
        label: "P1 연체 일수",
        helper: "특정 일수 이상 상대가 납부할 금액이 밀리면 즉시 확인 대상으로 변경하는, 밀리는 시점부터의 일수를 설정합니다.",
        type: "number",
        min: 0,
      },
      {
        key: "reminderDaysBeforeDue",
        label: "사전 알림 일수",
        helper: "결제 예정일을 기준으로 며칠 전부터 미수 위험 알림을 미리 띄울지 설정합니다.",
        type: "number",
        min: 0,
      },
      {
        key: "dormantAfterDays",
        label: "휴면 처리 일수",
        helper: "장기간 반응 없는 건을 해당 시점부터 몇 일 후에 관리 대상으로 돌릴지 설정합니다.",
        type: "number",
        min: 1,
      },
    ],
  },
  {
    title: "알림과 초안",
    description: "알림은 내부 대표/담당자에게 띄우는 경로이고, 초안은 고객 또는 거래처에 보낼 독촉 안내문을 자동 준비하는 설정입니다.",
    fields: [
      {
        key: "followUpCadenceDays",
        label: "재알림 주기",
        helper: "같은 건을 다시 띄우는 최소 간격입니다.",
        type: "number",
        min: 1,
      },
      {
        key: "alertChannels",
        label: "기본 알림 채널",
        helper: "고객이 아니라 내부 대표/담당자에게 P1 또는 P2 미수금 알림을 올릴 기본 채널입니다.",
        type: "checkbox-group",
        options: [
          { label: "대시보드", value: "dashboard" },
          { label: "카카오", value: "kakao" },
          { label: "이메일", value: "email" },
          { label: "슬랙", value: "slack" },
        ],
      },
      {
        key: "autoCreateDraftNotice",
        label: "독촉 초안 자동 준비",
        helper: "사람이 확인만 하면 보낼 수 있게 안내문 초안을 함께 만듭니다.",
        type: "checkbox",
      },
      {
        key: "pauseOnWeekends",
        label: "주말 알림 잠금",
        helper: "주말에는 같은 건을 다시 밀지 않고 월요일 아침으로 미룹니다.",
        type: "checkbox",
      },
    ],
  },
];

export default async function DunningSettingsPage() {
  const settings = await getWholesaleSettings();

  return (
    <WholesaleModuleSettingsScreen
      module="dunning"
      title="미수금 설정"
      description=""
      updatedAt={settings.updatedAt}
      initialValues={settings.dunning}
      highlights={[
        {
          label: "현재 P1(1순위로 확인해야 하는 금액 기준)",
          value: formatWonMan(settings.dunning.p1AmountThreshold),
          note: "P1은 대표/담당자가 가장 먼저 확인해야 하는 최우선 미수금 단계입니다.",
        },
        {
          label: "현재 P1(1순위로 확인해야 하는 금액 기준) 연체 일수",
          value: `${settings.dunning.p1OverdueDays}일`,
          note: "이 일수 이상 밀린 미수금은 금액과 무관하게 최우선 확인 단계로 올립니다.",
        },
        {
          label: "재알림 주기",
          value: `${settings.dunning.followUpCadenceDays}일`,
          note: "같은 건을 너무 자주 올리지 않도록 최소 간격을 묶어둡니다.",
        },
      ]}
      sections={sections}
    />
  );
}
