import { IntegrationModuleSettingsScreen } from "@/components/admin/integration-module-settings-screen";
import { getMobileDetectorOverview } from "@/lib/mobile-detector";
import { formatDateTime, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MobileDetectorSettingsPage() {
  const overview = await getMobileDetectorOverview();
  const summary = overview.summary;
  const activeDevices = summary?.active_devices_30m ?? overview.devices.filter((device) => !device.stale_30m).length;
  const staleDevices = summary?.stale_devices_30m ?? overview.devices.filter((device) => device.stale_30m).length;

  return (
    <IntegrationModuleSettingsScreen
      title="모바일 감지기 상태"
      description="직원 휴대폰에서 올라오는 현장 접수, 알림 수집, 업로드 상태를 확인합니다."
      updatedAt={overview.checkedAt}
      highlights={[
        {
          label: "수집기 연결",
          value: overview.connected ? "정상" : "확인 필요",
          note: overview.connected ? "모바일 수집기 API가 응답하고 있습니다." : overview.error ?? "모바일 수집기 연결 상태를 확인해야 합니다.",
        },
        {
          label: "활성 기기",
          value: `${formatNumber(activeDevices)}대`,
          note: "최근 30분 안에 정상 보고된 직원 기기 수입니다.",
        },
        {
          label: "대기 입력",
          value: `${formatNumber(summary?.pending_engine_inputs ?? 0)}건`,
          note: "엔진이 아직 처리하지 않은 모바일 접수 입력입니다.",
        },
      ]}
      sections={[
        {
          title: "수집 상태",
          description: "모바일 감지기가 현재 어떤 상태로 접수를 모으는지 보여줍니다.",
          items: [
            { label: "엔진 주소", value: overview.publicEngineBaseUrl, note: "직원 앱에서 접속하는 공개 주소입니다." },
            { label: "비활성 기기", value: `${formatNumber(staleDevices)}대`, note: "최근 30분 안에 보고되지 않은 기기입니다." },
            { label: "24시간 업로드", value: `${formatNumber(summary?.uploaded_batches_24h ?? 0)}건`, note: "최근 하루 동안 올라온 모바일 접수 묶음입니다." },
            { label: "큐 대기량", value: `${formatNumber(summary?.queue_depth_sum ?? 0)}건`, note: "기기 안에서 아직 업로드 대기 중인 항목입니다." },
          ],
        },
        {
          title: "최근 기기",
          description: "최근 보고된 직원 기기와 마지막 연결 시간을 확인합니다.",
          items: overview.devices.length
            ? overview.devices.slice(0, 6).map((device) => ({
                label: device.device_label ?? device.model ?? device.device_id,
                value: device.stale_30m ? "확인 필요" : "정상",
                note: `${device.manufacturer ?? "기기"} / 마지막 확인 ${formatDateTime(device.last_seen_at)}`,
              }))
            : [{ label: "등록 기기", value: "없음", note: "아직 모바일 감지기에 등록된 기기가 없습니다." }],
        },
      ]}
    />
  );
}
