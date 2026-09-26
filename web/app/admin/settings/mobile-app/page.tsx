import { IntegrationModuleSettingsScreen } from "@/components/admin/integration-module-settings-screen";
import { getMobileAppDownloadInfo } from "@/lib/mobile-app-download";
import { createMobilePairingCode, getMobilePairingCodes } from "@/lib/mobile-detector";

export const dynamic = "force-dynamic";

async function getReadyPairingCodes() {
  const codes = await getMobilePairingCodes(8);
  if (codes.some((code) => code.active)) {
    return codes;
  }

  try {
    const created = await createMobilePairingCode({
      label: "FlowFit 기본 연결 QR",
      max_uses: 3,
      expires_in_hours: 24,
    });
    return [created, ...codes].slice(0, 8);
  } catch {
    return codes;
  }
}

function formatFileSize(sizeBytes: number) {
  if (!sizeBytes) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export default async function MobileAppSettingsPage() {
  const [appDownload, pairingCodes] = await Promise.all([getMobileAppDownloadInfo(), getReadyPairingCodes()]);
  const activeCodes = pairingCodes.filter((code) => code.active && !code.expired && !code.exhausted);

  return (
    <IntegrationModuleSettingsScreen
      title="현장 접수 앱 연결"
      description="직원이 현장에서 접수한 주문, 클레임, 확인 내용을 FlowFit으로 보내기 위한 모바일 앱과 연결 코드를 관리합니다."
      updatedAt={appDownload.updatedAt ?? pairingCodes[0]?.updated_at}
      highlights={[
        {
          label: "접수 앱 파일",
          value: appDownload.available ? "준비됨" : "확인 필요",
          note: appDownload.available ? "직원 휴대폰에 설치할 앱 파일을 내려받을 수 있습니다." : "앱 파일이 준비되지 않아 배포 상태를 확인해야 합니다.",
        },
        {
          label: "활성 연결 코드",
          value: `${activeCodes.length}개`,
          note: "직원이 앱을 FlowFit에 연결할 때 쓰는 현재 유효한 코드입니다.",
        },
        {
          label: "앱 버전",
          value: appDownload.versionName,
          note: `${appDownload.fileName} / ${formatFileSize(appDownload.sizeBytes)}`,
        },
      ]}
      sections={[
        {
          title: "앱 다운로드",
          description: "직원 기기에 설치할 현장 접수 앱 정보입니다.",
          items: [
            { label: "앱 이름", value: appDownload.appName, note: appDownload.packageName },
            { label: "다운로드 경로", value: appDownload.publicDownloadUrl, note: "직원에게 전달할 설치 링크입니다." },
            { label: "파일 상태", value: appDownload.available ? "사용 가능" : "파일 없음", note: appDownload.downloadPath },
          ],
        },
        {
          title: "연결 코드",
          description: "직원이 모바일 앱을 FlowFit 계정에 묶을 때 사용하는 코드입니다.",
          items: pairingCodes.length
            ? pairingCodes.slice(0, 6).map((code) => ({
                label: code.label,
                value: code.pairing_code,
                note: `${code.active ? "활성" : code.status} / 남은 사용 ${code.remaining_uses ?? "-"}회`,
              }))
            : [{ label: "연결 코드", value: "없음", note: "모바일 수집기 API 연결을 확인해야 합니다." }],
        },
      ]}
    />
  );
}
