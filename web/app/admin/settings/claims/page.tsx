import {
  WholesaleModuleSettingsScreen,
  type WholesaleSettingsFieldSection,
} from "@/components/admin/wholesale-module-settings-screen";
import { getWholesaleSettings } from "@/lib/wholesale-settings";

export const dynamic = "force-dynamic";

const assignmentModeLabels: Record<string, string> = {
  "partner-owner": "거래처 담당자 우선",
  "round-robin": "순번 배정",
  manual: "수동 배정",
};

const sections: WholesaleSettingsFieldSection[] = [
  {
    title: "자동 분류 기준",
    description: "클레임을 몇 가지 분류로 나누고, 자동 분류를 켤지 정합니다.",
    fields: [
      {
        key: "autoClassifyEnabled",
        label: "자동 분류 사용",
        helper: "들어온 반품·클레임을 AI가 먼저 분류해 큐를 정리합니다.",
        type: "checkbox",
      },
      {
        key: "enabledCategories",
        label: "활성 분류 카테고리",
        helper: "현재 현장에서 쓰는 분류만 남겨 화면을 단순하게 유지합니다.",
        type: "checkbox-group",
        options: [
          { label: "품질", value: "품질" },
          { label: "수량", value: "수량" },
          { label: "납기", value: "납기" },
          { label: "단가", value: "단가" },
          { label: "기타", value: "기타" },
        ],
      },
    ],
  },
  {
    title: "우선순위와 배정",
    description: "높은 우선순위 키워드와 기본 담당자 배정 방식을 정합니다.",
    fields: [
      {
        key: "highPriorityKeywords",
        label: "P1 키워드",
        helper: "쉼표로 나눠 입력합니다. 여기에 걸리면 바로 강한 확인 카드로 올립니다.",
        type: "textarea",
        placeholder: "예: 파손, 오배송, 전량 반품",
      },
      {
        key: "mediumPriorityKeywords",
        label: "P2 키워드",
        helper: "P1보다는 낮지만 오늘 안에 보아야 할 표현을 넣습니다.",
        type: "textarea",
        placeholder: "예: 누락, 부분 반품, 지연",
      },
      {
        key: "autoAssignMode",
        label: "기본 배정 방식",
        helper: "클레임 카드를 누구에게 우선 붙일지 정합니다.",
        type: "select",
        options: [
          { label: "거래처 담당 우선", value: "partner-owner" },
          { label: "순번 배정", value: "round-robin" },
          { label: "수동 배정", value: "manual" },
        ],
      },
      {
        key: "defaultAssignee",
        label: "기본 담당자 이름",
        helper: "수동 배정이거나 담당자가 비어 있을 때 기본으로 붙입니다.",
        type: "text",
        placeholder: "예: 영업 담당",
      },
      {
        key: "accumulatedCountThreshold",
        label: "누적 경고 건수",
        helper: "같은 거래처에서 이 건수 이상 쌓이면 별도 경고로 올립니다.",
        type: "number",
        min: 1,
      },
      {
        key: "alertChannels",
        label: "기본 알림 채널",
        helper: "클레임 누적 또는 심각 건을 어디로 먼저 올릴지 정합니다.",
        type: "checkbox-group",
        options: [
          { label: "대시보드", value: "dashboard" },
          { label: "카카오", value: "kakao" },
          { label: "이메일", value: "email" },
          { label: "슬랙", value: "slack" },
        ],
      },
    ],
  },
];

export default async function ClaimsSettingsPage() {
  const settings = await getWholesaleSettings();

  return (
    <WholesaleModuleSettingsScreen
      module="claims"
      title="반품·클레임 설정"
      description="들어온 클레임을 에이전트가 어떤 기준에서 분류와 우선순위로 처리할지 설정합니다."
      updatedAt={settings.updatedAt}
      initialValues={settings.claims}
      highlights={[
        {
          label: "에이전트 클레임 분류를 위한 단계·키워드 항목 수",
          value: `${settings.claims.enabledCategories.length}종`,
          note: "에이전트가 반품·클레임을 나눌 때 키워드를 사용해 클레임을 분류하는 항목들의 개수입니다.",
        },
        {
          label: "기본 배정 방식",
          value: assignmentModeLabels[settings.claims.autoAssignMode] ?? settings.claims.autoAssignMode,
          note: "새 클레임 카드가 누구에게 먼저 붙는지 보여줍니다.",
        },
        {
          label: "누적 경고 기준",
          value: `${settings.claims.accumulatedCountThreshold}건`,
          note: "같은 거래처에서 이 수 이상 쌓이면 강하게 올립니다.",
        },
      ]}
      sections={sections}
    />
  );
}
