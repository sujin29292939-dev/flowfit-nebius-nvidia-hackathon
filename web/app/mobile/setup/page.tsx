import type { Metadata } from "next";

import { getMobileAppDownloadInfo } from "@/lib/mobile-app-download";
import { createMobilePairingCode, getMobilePairingCodes } from "@/lib/mobile-detector";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FlowFit 휴대폰 연결",
  description: "FlowFit 모바일 감지기를 다운로드하고 최신 연결 정보를 앱으로 보냅니다.",
};

function getText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

function normalizePairingCode(value: string) {
  const compact = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!compact) {
    return "";
  }

  if (/^FF[A-Z0-9]{6}$/.test(compact)) {
    return `FF-${compact.slice(2)}`;
  }

  if (/^[A-Z0-9]{6}$/.test(compact)) {
    return `FF-${compact}`;
  }

  return value.trim().toUpperCase();
}

async function resolveReadyPairingCode(requestedPairingCode: string) {
  const normalizedRequestedCode = normalizePairingCode(requestedPairingCode);
  const codes = await getMobilePairingCodes(20);
  const matchingRequestedCode = codes.find(
    (item) => normalizePairingCode(item.pairing_code) === normalizedRequestedCode && item.active,
  );

  if (matchingRequestedCode) {
    return {
      pairingCode: matchingRequestedCode.pairing_code,
      expiresAt: matchingRequestedCode.expires_at ?? "",
      recovered: false,
    };
  }

  try {
    const created = await createMobilePairingCode({
      label: "FlowFit 자동 복구 연결 QR",
      max_uses: 20,
      expires_in_hours: 24,
    });

    return {
      pairingCode: created.pairing_code,
      expiresAt: created.expires_at ?? "",
      recovered: Boolean(normalizedRequestedCode),
    };
  } catch {
    const activeFallback = codes.find((item) => item.active);

    return {
      pairingCode: activeFallback?.pairing_code ?? normalizedRequestedCode,
      expiresAt: activeFallback?.expires_at ?? "",
      recovered: Boolean(normalizedRequestedCode && activeFallback?.pairing_code),
    };
  }
}

function buildAppOpenUrl(input: {
  pairingCode: string;
  engineBaseUrl: string;
  expiresAt: string;
}) {
  const url = new URL("flowfit://mobile/setup");
  if (input.pairingCode) {
    url.searchParams.set("code", input.pairingCode);
  }
  if (input.engineBaseUrl) {
    url.searchParams.set("engine", input.engineBaseUrl);
  }
  if (input.expiresAt) {
    url.searchParams.set("expires", input.expiresAt);
  }

  return url.toString();
}

export default async function MobileSetupPage({
  searchParams,
}: {
  searchParams?: {
    code?: string | string[];
    engine?: string | string[];
    expires?: string | string[];
  };
}) {
  const appDownload = await getMobileAppDownloadInfo();
  const requestedPairingCode = getText(searchParams?.code);
  const engineBaseUrl = getText(searchParams?.engine);
  const readyPairing = await resolveReadyPairingCode(requestedPairingCode);
  const appOpenUrl = buildAppOpenUrl({
    pairingCode: readyPairing.pairingCode,
    engineBaseUrl,
    expiresAt: readyPairing.expiresAt,
  });

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl flex-col justify-center">
        <div className="rounded-[2rem] border border-white/10 bg-white p-6 text-slate-950 shadow-2xl">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-sky-700">FlowFit 휴대폰 연결</p>
            <h1 className="text-3xl font-bold tracking-tight">먼저 앱을 설치해 주세요</h1>
            <p className="text-sm leading-6 text-slate-600">
              설치 후 아래의 <strong>앱 열고 연결값 보내기</strong>를 누르면 PC의 FlowFit 엔진 주소와
              최신 연결 코드가 앱으로 전달됩니다.
            </p>
          </div>

          {readyPairing.recovered ? (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
              이전 QR 코드가 만료되어 새 연결 코드를 자동으로 만들었습니다. 아래 코드로 연결하면 됩니다.
            </div>
          ) : null}

          <div className="mt-6 space-y-3">
            {appDownload.available ? (
              <a
                href={appDownload.downloadPath}
                className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-4 text-base font-bold text-white shadow-lg transition hover:bg-slate-800"
              >
                1. FlowFit 앱 다운로드
              </a>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                현재 APK 파일을 찾지 못했습니다. PC에서 모바일 앱을 다시 빌드한 뒤 새로고침해 주세요.
              </div>
            )}

            <a
              href={appOpenUrl}
              className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-sky-600 px-5 py-4 text-base font-bold text-white shadow-lg transition hover:bg-sky-500"
            >
              2. 앱 열고 연결값 보내기
            </a>

            <a
              href={appDownload.publicDownloadUrl}
              className="block break-all rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-xs font-medium text-slate-600"
            >
              다운로드 링크: {appDownload.publicDownloadUrl}
            </a>
          </div>

          <div className="mt-6 grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-500">연결 코드</p>
              <p className="mt-2 break-all font-mono text-2xl font-black tracking-[0.18em] text-slate-950">
                {readyPairing.pairingCode || "-"}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-500">PC 엔진 주소</p>
              <p className="mt-2 break-all font-mono text-sm font-semibold text-slate-950">
                {engineBaseUrl || "-"}
              </p>
            </div>

            {readyPairing.expiresAt ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium text-slate-500">코드 만료</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{readyPairing.expiresAt}</p>
              </div>
            ) : null}
          </div>

          <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900">
            Android가 “알 수 없는 앱 설치”를 물으면 허용해 주세요. 설치 후 앱에서 알림 접근 권한을 켜면
            휴대폰 알림이 PC FlowFit으로 전달됩니다.
          </div>
        </div>
      </div>
    </main>
  );
}
