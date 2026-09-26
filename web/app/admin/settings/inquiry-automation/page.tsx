import { IntegrationModuleSettingsScreen } from "@/components/admin/integration-module-settings-screen";
import { getAdminSettings } from "@/lib/customer-engine";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function InquiryAutomationSettingsPage() {
  const settings = await getAdminSettings();
  const enabledRules = settings.notificationRules.filter((rule) => rule.enabled);
  const enabledExceptionLinks = settings.exceptionInboxLinks.filter((link) => link.enabled);

  return (
    <IntegrationModuleSettingsScreen
      title="문의 접수 자동화 기준"
      description="고객 문의가 들어왔을 때 어떤 기준으로 주의 표시, 예외 접수, 알림 전환을 할지 확인합니다."
      highlights={[
        {
          label: "활성 알림 규칙",
          value: `${formatNumber(enabledRules.length)}개`,
          note: "현재 자동화 판단에 실제로 쓰는 알림 규칙입니다.",
        },
        {
          label: "주의 표시 기준",
          value: `${formatNumber(settings.badgeRules.warningThreshold)}`,
          note: "이 기준 이상이면 사용자가 확인하기 쉽도록 주의 단계로 표시합니다.",
        },
        {
          label: "위험 표시 기준",
          value: `${formatNumber(settings.badgeRules.criticalThreshold)}`,
          note: "이 기준 이상이면 더 강한 확인 대상으로 올립니다.",
        },
      ]}
      sections={[
        {
          title: "문제 표시 기준",
          description: "문의가 주의 또는 위험으로 보이는 기준입니다.",
          items: [
            { label: "주의 기준", value: `${settings.badgeRules.warningThreshold}`, note: "낮은 위험 신호를 사용자가 놓치지 않도록 표시합니다." },
            { label: "위험 기준", value: `${settings.badgeRules.criticalThreshold}`, note: "즉시 확인해야 하는 문의로 분리합니다." },
            { label: "기본 테스트 문구", value: settings.defaultTestTemplate, note: "자동화 기준 점검에 쓰는 기본 문장입니다." },
          ],
        },
        {
          title: "알림 규칙",
          description: "문의 상태가 바뀔 때 사용자에게 알려주는 기준입니다.",
          items: settings.notificationRules.map((rule) => ({
            label: rule.title,
            value: rule.enabled ? "사용 중" : "꺼짐",
            note: `${rule.condition} / ${rule.channel}`,
          })),
        },
        {
          title: "예외 접수 키워드",
          description: "AI가 일반 자동 처리 대신 예외 접수함으로 보내는 기준입니다.",
          items: enabledExceptionLinks.length
            ? enabledExceptionLinks.map((link) => ({
                label: link.keyword,
                value: link.url,
                note: link.description || "설명 없음",
              }))
            : [{ label: "예외 접수", value: "등록 없음", note: "현재 활성화된 예외 접수 링크가 없습니다." }],
        },
      ]}
    />
  );
}
