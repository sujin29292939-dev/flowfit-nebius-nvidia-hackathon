"use client";

import * as React from "react";
import { Copy, Download, KeyRound, QrCode, RefreshCw } from "lucide-react";

import { useToast } from "@/components/shared/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MobileAppDownloadInfo, MobilePairingCodeRecord } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

function getPrimaryCode(codes: MobilePairingCodeRecord[]) {
  return codes.find((item) => item.active) ?? codes[0] ?? null;
}

function isLoopbackUrl(value: string) {
  return value.includes("127.0.0.1") || value.includes("localhost");
}

function buildSetupUrl(
  pairingBaseUrl: string,
  pairingCode: MobilePairingCodeRecord,
  appDownload: MobileAppDownloadInfo,
) {
  const setupUrl = new URL("/mobile/setup", appDownload.publicDownloadUrl);
  setupUrl.searchParams.set("code", pairingCode.pairing_code);
  setupUrl.searchParams.set("engine", pairingBaseUrl);
  if (pairingCode.expires_at) {
    setupUrl.searchParams.set("expires", pairingCode.expires_at);
  }

  return setupUrl.toString();
}

function buildQrImageUrl(value: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=0&data=${encodeURIComponent(value)}`;
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes <= 0) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = sizeBytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const rounded = unitIndex === 0 ? String(size) : size.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

export function MobileConnectPanel({
  initialPairingCodes,
  pairingBaseUrl,
  appDownload,
}: {
  initialPairingCodes: MobilePairingCodeRecord[];
  pairingBaseUrl: string;
  appDownload: MobileAppDownloadInfo;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [pairingCodes, setPairingCodes] = React.useState(initialPairingCodes);
  const [showRecentCodes, setShowRecentCodes] = React.useState(false);

  const primaryCode = getPrimaryCode(pairingCodes);
  const setupUrl = primaryCode ? buildSetupUrl(pairingBaseUrl, primaryCode, appDownload) : null;
  const qrImageUrl = setupUrl ? buildQrImageUrl(setupUrl) : null;
  const needsReachableAddress = isLoopbackUrl(pairingBaseUrl);

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: `${label} 복사 완료`,
        description: `${label}를 클립보드에 복사했습니다.`,
        tone: "success",
      });
    } catch {
      toast({
        title: `${label} 복사 실패`,
        description: "브라우저 권한 문제로 복사하지 못했습니다.",
        tone: "error",
      });
    }
  }

  async function refreshCodes() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/mobile-detector/pairing-codes", {
        cache: "no-store",
      });
      const payload = (await response.json()) as { pairing_codes?: MobilePairingCodeRecord[] };

      if (!response.ok) {
        throw new Error("pairing_code_refresh_failed");
      }

      setPairingCodes(Array.isArray(payload.pairing_codes) ? payload.pairing_codes : []);
    } catch {
      toast({
        title: "연결 코드 목록을 불러오지 못했습니다",
        description: "3001 엔진 연결 상태를 다시 확인해 주세요.",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  async function createCode() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/mobile-detector/pairing-codes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as MobilePairingCodeRecord & {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? payload.message ?? "pairing_code_create_failed");
      }

      setPairingCodes((current) => {
        const next = [payload, ...current.filter((item) => item.pairing_code !== payload.pairing_code)];
        return next.slice(0, 8);
      });
      toast({
        title: "새 연결 QR을 만들었습니다",
        description: "이제 휴대폰 앱에서 바로 스캔할 수 있습니다.",
        tone: "success",
      });
    } catch {
      toast({
        title: "연결 QR 생성 실패",
        description: "모바일 관리자 API 상태를 다시 확인해 주세요.",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  function startDownload() {
    if (!appDownload.available) {
      toast({
        title: "앱 파일을 아직 찾지 못했습니다",
        description: "모바일 앱 빌드 파일을 다시 확인한 뒤 새로고침해 주세요.",
        tone: "error",
      });
      return;
    }

    window.location.assign(appDownload.publicDownloadUrl);
  }

  return (
    <Card className="border-sky-200 bg-sky-50/40">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <CardTitle>폰 연결</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant={appDownload.available ? "success" : "warning"}>
              {appDownload.available ? "앱 다운로드 가능" : "APK 파일 없음"}
            </Badge>
            <Badge variant="info">{appDownload.versionName}</Badge>
            <Badge variant="default">{formatFileSize(appDownload.sizeBytes)}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="default" onClick={startDownload} disabled={!appDownload.available}>
            <Download className="h-4 w-4" />
            앱 다운로드
          </Button>
          <Button variant="outline" onClick={createCode} disabled={loading}>
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            새 QR 만들기
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="rounded-2xl border border-border bg-white p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-950">모바일 앱 다운로드</p>
              <p className="text-sm leading-6 text-slate-600">
                휴대폰에서 아래 버튼을 누르면 FlowFit 감지기 APK를 바로 내려받을 수 있습니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!appDownload.available} onClick={startDownload}>
                <Download className="h-4 w-4" />
                지금 다운로드
              </Button>
              <Button
                variant="outline"
                onClick={() => void copyText(appDownload.publicDownloadUrl, "다운로드 링크")}
              >
                <Copy className="h-4 w-4" />
                링크 복사
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-500">다운로드 링크</p>
              <div className="mt-2 break-all rounded-xl border border-border bg-white px-3 py-3 font-mono text-sm text-slate-900">
                {appDownload.publicDownloadUrl}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-slate-50 p-4 text-sm text-slate-600">
              <p>앱 이름: {appDownload.appName}</p>
              <p className="mt-2">패키지: {appDownload.packageName}</p>
              <p className="mt-2">
                마지막 빌드: {appDownload.updatedAt ? formatDateTime(appDownload.updatedAt) : "-"}
              </p>
            </div>
          </div>

          {!appDownload.available ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              현재 APK 빌드 파일을 찾지 못했습니다. 모바일 앱을 다시 빌드한 뒤 이 페이지를 새로고침해
              주세요.
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.88fr_1.12fr]">
          <div className="rounded-2xl border border-border bg-white p-5">
            <div className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-slate-700" />
              <p className="text-sm font-semibold text-slate-950">연결 QR</p>
            </div>

            {primaryCode && qrImageUrl ? (
              <div className="mt-4 flex flex-col items-center gap-4">
                <img
                  src={qrImageUrl}
                  alt="FlowFit 폰 연결 QR"
                  className="h-72 w-72 rounded-2xl border border-border bg-white p-3 shadow-sm"
                  referrerPolicy="no-referrer"
                />
                <div className="flex flex-wrap justify-center gap-2">
                  <Badge variant={primaryCode.active ? "success" : "warning"}>
                    {primaryCode.active ? "지금 바로 사용 가능" : "새 QR 생성 필요"}
                  </Badge>
                  <Badge variant="info">
                    만료 {primaryCode.expires_at ? formatDateTime(primaryCode.expires_at) : "-"}
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!setupUrl) {
                      return;
                    }

                    void copyText(setupUrl, "QR 연결 정보");
                  }}
                >
                  <Copy className="h-4 w-4" />
                  QR 연결 정보 복사
                </Button>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-border bg-slate-50 p-6 text-sm text-slate-600">
                아직 사용할 QR이 없습니다. 새 QR 만들기를 눌러 연결을 시작해 주세요.
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-white p-4">
              <p className="text-sm font-semibold text-slate-950">연결 순서</p>
              <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
                <p>1. 휴대폰에서 앱 다운로드 버튼을 눌러 앱을 설치합니다.</p>
                <p>2. 설치한 앱을 열고 QR 연결 화면으로 들어갑니다.</p>
                <p>3. 이 페이지의 연결 QR을 스캔합니다.</p>
                <p>4. 휴대폰에서 알림 접근 권한을 허용합니다.</p>
                <p>5. 아래 모바일 감지기 상태판에 새 기기가 보이면 연결이 끝난 것입니다.</p>
              </div>

              {needsReachableAddress ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  QR 주소가 아직 로컬 주소입니다. 휴대폰에서 바로 붙지 않으면 같은 와이파이에서 접근 가능한
                  PC 주소로 바꿔 주세요.
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-border bg-white p-4">
              <p className="text-sm font-semibold text-slate-950">QR이 안 되면 직접 입력</p>
              <div className="mt-3 space-y-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">연결 주소</p>
                  <div className="mt-2 flex gap-2">
                    <div className="flex-1 break-all rounded-xl border border-border bg-slate-50 px-3 py-3 font-mono text-sm text-slate-900">
                      {pairingBaseUrl}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(pairingBaseUrl, "연결 주소")}
                    >
                      <Copy className="h-4 w-4" />
                      복사
                    </Button>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-500">연결 코드</p>
                  {primaryCode ? (
                    <div className="mt-2 space-y-3">
                      <div className="rounded-xl border border-border bg-slate-950 px-4 py-4 font-mono text-lg font-semibold tracking-[0.16em] text-white">
                        {primaryCode.pairing_code}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="default">남은 사용 {primaryCode.remaining_uses ?? "무제한"}</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void copyText(primaryCode.pairing_code, "연결 코드")}
                        >
                          <Copy className="h-4 w-4" />
                          코드 복사
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 rounded-xl border border-dashed border-border bg-slate-50 px-4 py-4 text-sm text-slate-600">
                      아직 연결 코드가 없습니다.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-950">최근 발급 코드</p>
              <p className="mt-1 text-sm text-slate-600">
                {pairingCodes.length > 0
                  ? `${pairingCodes.length}개 코드가 있습니다.`
                  : "아직 발급된 연결 코드가 없습니다."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={refreshCodes} disabled={loading}>
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                새로고침
              </Button>
              <Button
                variant={showRecentCodes ? "secondary" : "default"}
                size="sm"
                onClick={() => setShowRecentCodes((current) => !current)}
              >
                {showRecentCodes ? "접기" : "자세히 보기"}
              </Button>
            </div>
          </div>

          {!showRecentCodes ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              {primaryCode ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500">현재 QR에 반영된 코드</p>
                    <p className="mt-1 font-mono text-lg font-semibold tracking-[0.14em] text-slate-950">
                      {primaryCode.pairing_code}
                    </p>
                  </div>
                  <Badge variant={primaryCode.active ? "success" : "warning"}>
                    {primaryCode.active ? "사용 가능" : primaryCode.expired ? "만료" : "사용 완료"}
                  </Badge>
                </div>
              ) : (
                <p className="text-sm text-slate-600">새 QR 만들기를 눌러 연결 코드를 발급해 주세요.</p>
              )}
            </div>
          ) : (
            <div className="mt-5 rounded-[28px] border border-slate-200 bg-slate-950 p-5 shadow-panel">
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Recent Codes</p>
                  <p className="mt-1 text-xl font-semibold text-white">최근 발급 코드 전체 보기</p>
                </div>
                <p className="text-sm text-slate-300">필요한 코드를 복사하거나 상태를 확인합니다.</p>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {pairingCodes.length > 0 ? (
                  pairingCodes.map((item) => (
                    <div
                      key={item.pairing_code}
                      className="rounded-3xl border border-white/10 bg-white/10 p-5 text-white"
                    >
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-xl font-semibold tracking-[0.14em] text-white">
                            {item.pairing_code}
                          </p>
                          <Badge variant={item.active ? "success" : "warning"}>
                            {item.active ? "사용 가능" : item.expired ? "만료" : "사용 완료"}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-200">{item.label}</p>
                        <p className="text-xs leading-5 text-slate-400">
                          발급 {formatDateTime(item.created_at)} / 만료{" "}
                          {item.expires_at ? formatDateTime(item.expires_at) : "-"}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="default">사용 {item.use_count}회</Badge>
                          <Badge variant="default">남은 사용 {item.remaining_uses ?? "무제한"}</Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void copyText(item.pairing_code, "연결 코드")}
                          >
                            <Copy className="h-4 w-4" />
                            복사
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-white/20 bg-white/10 p-6 text-sm text-slate-300 xl:col-span-2">
                    아직 발급된 연결 코드가 없습니다.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
