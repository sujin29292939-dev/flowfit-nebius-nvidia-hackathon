import { InquiryAutomationSettingsPanel } from "@/components/admin/inquiry-automation-settings-panel";
import { getBrowserAutomationOverview } from "@/lib/browser-automation-bridge";
import { WholesaleSettingsHub } from "@/components/admin/wholesale-settings-hub";
import { getAdminSettings } from "@/lib/customer-engine";
import { getMobileAppDownloadInfo } from "@/lib/mobile-app-download";
import {
  createMobilePairingCode,
  getMobileDetectorOverview,
  getMobilePairingCodes,
} from "@/lib/mobile-detector";
import { getWholesaleSettings } from "@/lib/wholesale-settings";

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

export default async function AdminSettingsPage() {
  const [
    settings,
    mobileDetectorOverview,
    pairingCodes,
    mobileAppDownload,
    wholesaleSettings,
    browserAutomationOverview,
  ] =
    await Promise.all([
      getAdminSettings(),
      getMobileDetectorOverview(),
      getReadyPairingCodes(),
      getMobileAppDownloadInfo(),
      getWholesaleSettings(),
      getBrowserAutomationOverview(),
    ]);

  return (
    <div className="grid min-h-full gap-3">
      <WholesaleSettingsHub settings={wholesaleSettings} />

      <InquiryAutomationSettingsPanel
        settings={settings}
        mobileDetectorOverview={mobileDetectorOverview}
        pairingCodes={pairingCodes}
        mobileAppDownload={mobileAppDownload}
        browserAutomationOverview={browserAutomationOverview}
      />
    </div>
  );
}
