import {
  Activity,
  AlertTriangle,
  ShieldAlert,
  Smartphone,
  Upload,
  Workflow,
} from "lucide-react";

import { MetricCard } from "@/components/shared/metric-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MobileDetectorDevice, MobileDetectorOverview } from "@/lib/types";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/utils";

function getDeviceLabel(device: MobileDetectorDevice) {
  if (device.device_label?.trim()) return device.device_label.trim();

  const fallback = [device.manufacturer, device.model].filter(Boolean).join(" ").trim();
  if (fallback) return fallback;

  return device.device_id;
}

function getDeviceSubLabel(device: MobileDetectorDevice) {
  if (device.manufacturer && device.model) {
    return `${device.manufacturer} / ${device.model}`;
  }
  return device.manufacturer ?? device.model ?? "등록된 기기";
}

function BooleanBadge({
  value,
  trueLabel,
  falseLabel,
}: {
  value: boolean | null | undefined;
  trueLabel: string;
  falseLabel: string;
}) {
  if (value) {
    return <Badge variant="success">{trueLabel}</Badge>;
  }

  return <Badge variant="warning">{falseLabel}</Badge>;
}

export function MobileDetectorStatusPanel({
  overview,
}: {
  overview: MobileDetectorOverview;
}) {
  if (!overview.connected || !overview.summary) {
    return (
      <Card className="border-rose-200 bg-rose-50/50">
        <CardHeader>
          <CardTitle>모바일 감지기 상태</CardTitle>
          <CardDescription>
            3001 엔진의 모바일 인입 관제판을 읽지 못하고 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-700">
          <div className="flex items-center gap-2 text-rose-700">
            <AlertTriangle className="h-4 w-4" />
            <p className="font-medium">{overview.error ?? "mobile_detector_unavailable"}</p>
          </div>
          <p>조회 대상: {overview.engineBaseUrl}/v1/mobile/admin/fleet-summary</p>
          <p>마지막 확인: {formatDateTime(overview.checkedAt)}</p>
        </CardContent>
      </Card>
    );
  }

  const summary = overview.summary;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>모바일 감지기 상태</CardTitle>
            <CardDescription>
              모바일 알림 수집기가 3001 엔진으로 올린 heartbeat, 업로드, 중복 비율을 읽어옵니다.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value="connected" />
            <Badge variant="info">정책 v{summary.policy_version}</Badge>
            <Badge variant="default">기본 {summary.default_action}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-600">
          <div className="grid gap-4 xl:grid-cols-4">
            <MetricCard
              title="활성 기기"
              value={summary.active_devices_30m}
              description={`총 ${formatNumber(summary.total_devices)}대 중 최근 30분 활성`}
              icon={Smartphone}
              tone="success"
            />
            <MetricCard
              title="멈춘 기기"
              value={summary.stale_devices_30m}
              description="30분 이상 heartbeat가 없는 기기"
              icon={Activity}
              tone={summary.stale_devices_30m > 0 ? "warning" : "default"}
            />
            <MetricCard
              title="엔진 대기 입력"
              value={summary.pending_engine_inputs}
              description="모바일 이벤트가 엔진 입력으로 쌓인 수"
              icon={Workflow}
              tone={summary.pending_engine_inputs > 0 ? "warning" : "default"}
            />
            <MetricCard
              title="중복 비율"
              value={formatPercent(summary.duplicate_rate_24h * 100, 1)}
              description={`최근 24시간 업로드 ${formatNumber(summary.uploaded_batches_24h)}회`}
              icon={Upload}
              tone={summary.duplicate_rate_24h > 0.2 ? "warning" : "default"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-950">운영 신호</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant={summary.permission_off_devices > 0 ? "warning" : "success"}>
                  권한 꺼짐 {formatNumber(summary.permission_off_devices)}대
                </Badge>
                <Badge variant={summary.queue_depth_sum > 0 ? "info" : "default"}>
                  누적 queue {formatNumber(summary.queue_depth_sum)}
                </Badge>
                <Badge variant="default">조회 시각 {formatDateTime(overview.checkedAt)}</Badge>
              </div>
              <p className="mt-3 text-xs text-slate-500">엔진 주소: {overview.engineBaseUrl}</p>
            </div>

            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-950">제조사별 현황</p>
              {summary.manufacturers.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {summary.manufacturers.slice(0, 5).map((item) => (
                    <div
                      key={item.manufacturer}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div>
                        <p className="font-medium text-slate-900">{item.manufacturer}</p>
                        <p className="text-xs text-slate-500">
                          멈춤 {formatNumber(item.stale_devices_30m)} / 권한 꺼짐{" "}
                          {formatNumber(item.permission_off_devices)}
                        </p>
                      </div>
                      <Badge variant="default">{formatNumber(item.total_devices)}대</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-600">아직 등록된 모바일 기기가 없습니다.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>최근 모바일 기기</CardTitle>
          <CardDescription>
            기기 연결 여부, 권한 상태, 마지막 heartbeat를 빠르게 확인합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {overview.devices.length > 0 ? (
            overview.devices.map((device) => (
              <div
                key={device.device_id}
                className="rounded-2xl border border-border bg-slate-50 p-4"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{getDeviceLabel(device)}</p>
                      <Badge variant={device.stale_30m ? "warning" : "success"}>
                        {device.stale_30m ? "heartbeat 지연" : "heartbeat 정상"}
                      </Badge>
                      <Badge variant="default">queue {formatNumber(device.queue_depth)}</Badge>
                    </div>
                    <p className="text-sm text-slate-600">{getDeviceSubLabel(device)}</p>
                    <div className="flex flex-wrap gap-2">
                      <BooleanBadge
                        value={device.listener_connected}
                        trueLabel="감지기 연결됨"
                        falseLabel="감지기 분리"
                      />
                      <BooleanBadge
                        value={device.notification_access_granted}
                        trueLabel="알림 권한 허용"
                        falseLabel="알림 권한 꺼짐"
                      />
                      {device.last_reported_policy_version ? (
                        <Badge variant="info">정책 v{device.last_reported_policy_version}</Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-1 text-xs text-slate-500 xl:text-right">
                    <p>마지막 heartbeat: {formatDateTime(device.last_heartbeat_at)}</p>
                    <p>마지막 업로드 성공: {formatDateTime(device.last_upload_success_at)}</p>
                    <p>device_id: {device.device_id}</p>
                    <p>installation_id: {device.installation_id}</p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-slate-50 p-6 text-sm text-slate-600">
              아직 페어링된 모바일 기기가 없습니다.
            </div>
          )}

          <div className="rounded-2xl border border-border bg-slate-50 p-4 text-sm text-slate-600">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 text-slate-500" />
              <p>
                이 화면은 모바일 감지기가 직접 푸시하는 대상이 아니라, 3001 엔진이 가진 상태를 읽는
                조회판입니다.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
