import { IntegrationModuleSettingsScreen } from "@/components/admin/integration-module-settings-screen";
import { getBrowserAutomationOverview } from "@/lib/browser-automation-bridge";
import { formatDateTime, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function BrowserAutomationSettingsPage() {
  const overview = await getBrowserAutomationOverview();
  const onlineSessions = overview.sessions.filter((session) => session.status === "online");
  const approvalPolicies = overview.policy.filter((policy) => policy.requiresApproval);
  const blockedPolicies = overview.policy.filter((policy) => policy.riskLevel === "blocked" || !policy.allowed);

  return (
    <IntegrationModuleSettingsScreen
      title="브라우저 자동화 연결"
      description="에이전트가 브라우저를 조작하는 범위, 승인 필요 명령, 최근 실행 상태를 확인합니다."
      updatedAt={overview.checkedAt}
      highlights={[
        {
          label: "브릿지 연결",
          value: overview.connected ? "정상" : "확인 필요",
          note: overview.connected ? "브라우저 브릿지와 통신하고 있습니다." : overview.error ?? "자동화할 브라우저를 설정합니다.",
        },
        {
          label: "온라인 세션",
          value: `${formatNumber(onlineSessions.length)}개`,
          note: "현재 연결된 브라우저 자동화 세션입니다.",
        },
        {
          label: "승인 필요 명령",
          value: `${formatNumber(approvalPolicies.length)}개`,
          note: "사용자 승인 없이 바로 실행하지 않는 명령 수입니다.",
        },
      ]}
      sections={[
        {
          title: "브라우저 세션",
          description: "현재 연결된 브라우저와 마지막 응답 시간을 확인합니다.",
          items: overview.sessions.length
            ? overview.sessions.slice(0, 6).map((session) => ({
                label: session.extension_name ?? session.browser ?? session.session_id,
                value: session.status,
                note: `${session.active_tab_title ?? "탭 정보 없음"} / 마지막 확인 ${formatDateTime(session.last_seen_at)}`,
              }))
            : [{ label: "연결 세션", value: "없음", note: "브라우저 확장 또는 브릿지 연결이 필요합니다." }],
        },
        {
          title: "명령 정책",
          description: "AI가 어떤 브라우저 명령을 바로 실행하거나 승인 요청해야 하는지 보여줍니다.",
          items: overview.policy.slice(0, 8).map((policy) => ({
            label: policy.label,
            value: policy.requiresApproval ? "승인 필요" : policy.allowed ? "허용" : "차단",
            note: policy.reason,
          })),
        },
        {
          title: "최근 실행 기록",
          description: "브라우저 자동화 명령의 최근 처리 결과입니다.",
          items: overview.commandAudit.length
            ? overview.commandAudit.slice(0, 6).map((entry) => ({
                label: entry.label,
                value: entry.status,
                note: `${entry.risk_level} / ${entry.result_summary ?? "결과 요약 없음"}`,
              }))
            : [{ label: "실행 기록", value: "없음", note: "아직 브라우저 자동화 실행 기록이 없습니다." }],
        },
        {
          title: "안전 제한",
          description: "자동화에서 막거나 사용자 확인을 요구하는 범위입니다.",
          items: [
            { label: "정책 버전", value: `v${overview.policyVersion}`, note: "현재 브라우저 자동화 내부의 제한 정책 버전을 표시합니다." },
            { label: "확장 토큰", value: overview.extensionTokenConfigured ? "설정됨" : "확인 필요", note: "브라우저 확장과 서버가 서로 확인할 때 쓰는 토큰입니다." },
            { label: "차단 명령", value: `${formatNumber(blockedPolicies.length)}개`, note: "AI가 실행할 수 없도록 막은 브라우저 명령입니다." },
          ],
        },
      ]}
    />
  );
}
