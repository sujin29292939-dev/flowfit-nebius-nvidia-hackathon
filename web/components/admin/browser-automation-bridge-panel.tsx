"use client";

import * as React from "react";
import {
  Bot,
  CheckCircle2,
  Clock,
  Eye,
  Globe2,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  Zap,
} from "lucide-react";

import { useToast } from "@/components/shared/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  BrowserAutomationAuditEntry,
  BrowserAutomationCommandPolicy,
  BrowserAutomationOverview,
  BrowserAutomationRiskLevel,
  GateApprovalRecord,
} from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

function riskBadgeVariant(riskLevel: BrowserAutomationRiskLevel) {
  if (riskLevel === "read_only") return "success" as const;
  if (riskLevel === "needs_approval") return "warning" as const;
  return "danger" as const;
}

function riskLabel(riskLevel: BrowserAutomationRiskLevel) {
  if (riskLevel === "read_only") return "읽기 전용";
  if (riskLevel === "needs_approval") return "승인 후 실행";
  return "차단";
}

function statusBadgeVariant(status: string) {
  if (status === "succeeded" || status === "online") return "success" as const;
  if (status === "waiting_approval" || status === "queued" || status === "delivered" || status === "stale") {
    return "warning" as const;
  }
  if (status === "failed" || status === "blocked" || status === "offline") return "danger" as const;
  return "default" as const;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    online: "연결됨",
    stale: "대기 중",
    offline: "오프라인",
    waiting_approval: "승인 대기",
    queued: "대기열 등록",
    delivered: "확장 전달",
    succeeded: "완료",
    failed: "실패",
    blocked: "정책 차단",
    cancelled: "취소",
    expired: "만료",
  };

  return labels[status] ?? status;
}

function PolicyRow({ policy }: { policy: BrowserAutomationCommandPolicy }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-950">{policy.label}</p>
            <Badge variant={riskBadgeVariant(policy.riskLevel)}>{riskLabel(policy.riskLevel)}</Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{policy.reason}</p>
        </div>
        <code className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {policy.name}
        </code>
      </div>
      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">
        {policy.tokenSavingRole}
      </div>
    </div>
  );
}

function AuditRow({ item }: { item: BrowserAutomationAuditEntry }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-950">{item.label}</p>
            <Badge variant={statusBadgeVariant(item.status)}>{statusLabel(item.status)}</Badge>
            <Badge variant={riskBadgeVariant(item.risk_level)}>{riskLabel(item.risk_level)}</Badge>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {item.command} · 요청자 {item.requested_by} · {formatDateTime(item.created_at)}
          </p>
          {item.target_url ? <p className="mt-1 break-all text-xs text-slate-400">{item.target_url}</p> : null}
        </div>
        {item.result_summary ? (
          <p className="max-w-sm rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">
            {item.result_summary}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function BrowserAutomationBridgePanel({
  overview: initialOverview,
}: {
  overview: BrowserAutomationOverview;
}) {
  const { toast } = useToast();
  const [overview, setOverview] = React.useState(initialOverview);
  const [gateApprovals, setGateApprovals] = React.useState<GateApprovalRecord[]>([]);
  const [loading, setLoading] = React.useState(false);
  const connectedSessions = overview.sessions.filter((session) => session.status === "online").length;
  const readOnlyPolicies = overview.policy.filter((item) => item.riskLevel === "read_only");
  const approvalPolicies = overview.policy.filter((item) => item.riskLevel === "needs_approval");
  const blockedPolicies = overview.policy.filter((item) => item.riskLevel === "blocked");

  async function refreshOverview() {
    setLoading(true);
    try {
      const [overviewResponse, approvalResponse] = await Promise.all([
        fetch("/api/admin/browser-bridge", { cache: "no-store" }),
        fetch("/api/gate/approvals", { cache: "no-store" }),
      ]);
      const payload = (await overviewResponse.json()) as BrowserAutomationOverview;
      const approvalPayload = (await approvalResponse.json().catch(() => ({}))) as {
        approvals?: GateApprovalRecord[];
      };
      if (!overviewResponse.ok) {
        throw new Error(payload.error ?? "browser_bridge_refresh_failed");
      }
      setOverview(payload);
      setGateApprovals(Array.isArray(approvalPayload.approvals) ? approvalPayload.approvals : []);
    } catch (error) {
      toast({
        title: "브라우저 브릿지 상태를 불러오지 못했습니다",
        description: error instanceof Error ? error.message : "3001 로컬 엔진 연결을 확인해주세요.",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void refreshOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reviewApproval(approvalId: string, approved: boolean) {
    setLoading(true);
    try {
      const response = await fetch(`/api/gate/approvals/${encodeURIComponent(approvalId)}/${approved ? "approve" : "reject"}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reviewedBy: "owner",
          note: approved ? "관리자 승인" : "관리자 거부",
        }),
      });
      if (!response.ok) {
        throw new Error("gate_approval_review_failed");
      }
      toast({
        title: approved ? "브라우저 명령을 승인했습니다" : "브라우저 명령을 거부했습니다",
        description: approved ? "확장 프로그램이 다음 폴링에서 명령을 가져갑니다." : "거부된 명령은 실행되지 않습니다.",
        tone: "success",
      });
      await refreshOverview();
    } catch (error) {
      toast({
        title: "승인 상태를 바꾸지 못했습니다",
        description: error instanceof Error ? error.message : "Gate API 상태를 확인해주세요.",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  async function createReadOnlyProbe() {
    setLoading(true);
    try {
      const response = await fetch("/api/gate/command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command: "GET_TEXT",
          label: "현재 화면 텍스트 추출 점검",
          targetUrl: "active-tab",
          params: { scope: "visible_text_only" },
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; status?: string };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "browser_bridge_command_failed");
      }

      toast({
        title: "Gate 큐에 읽기 전용 명령을 넣었습니다",
        description: payload.status === "approved" ? "확장이 다음 폴링에서 가져가 실행합니다." : "Gate 정책에 따라 대기 중입니다.",
        tone: "success",
      });
      await refreshOverview();
    } catch (error) {
      toast({
        title: "점검 명령을 만들지 못했습니다",
        description: error instanceof Error ? error.message : "로컬 엔진 상태를 확인해주세요.",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 bg-white">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-slate-700" />
              브라우저 자동화 브릿지
            </CardTitle>
            <CardDescription className="mt-2 leading-6">
              사업자가 로그인한 브라우저에서 문의, 주문, 답변 화면을 확인하되 로그인 정보는 읽지 않고,
              승인된 조작만 실행하도록 제한합니다.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={refreshOverview} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading ? "animate-spin" : "")} />
              새로고침
            </Button>
            <Button type="button" onClick={createReadOnlyProbe} disabled={loading}>
              <Eye className="h-4 w-4" />
              읽기 점검
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700">연결 상태</p>
                <Badge variant={overview.connected ? "success" : "warning"}>
                  {overview.connected ? "확장 연결됨" : "대기 중"}
                </Badge>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{connectedSessions}</p>
              <p className="mt-1 text-xs text-slate-500">온라인 확장 세션</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-slate-700">
                <ShieldCheck className="h-4 w-4" />
                <p className="text-sm font-semibold">읽기 전용</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{readOnlyPolicies.length}</p>
              <p className="mt-1 text-xs text-slate-500">AI 입력 절감용 허용 명령</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-slate-700">
                <Clock className="h-4 w-4" />
                <p className="text-sm font-semibold">승인 필요</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{approvalPolicies.length}</p>
              <p className="mt-1 text-xs text-slate-500">클릭, 입력, 이동 같은 조작</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-slate-700">
                <LockKeyhole className="h-4 w-4" />
                <p className="text-sm font-semibold">기본 차단</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{blockedPolicies.length}</p>
              <p className="mt-1 text-xs text-slate-500">쿠키, 저장소, 임의 스크립트</p>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="space-y-2 text-sm leading-6 text-amber-900">
                <p className="font-semibold">로그인 정보 보호 원칙</p>
                <p>
                  FlowFit은 사용자의 아이디, 비밀번호, 쿠키, 로컬스토리지 값을 수집하지 않습니다.
                  사용자가 직접 로그인한 브라우저 화면에서 필요한 업무 정보만 읽고, 외부 발송이나 입력은
                  승인 큐를 통과한 뒤 실행합니다.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Zap className="h-4 w-4 text-slate-600" />
                토큰 사용 절감 흐름
              </p>
              <div className="mt-4 space-y-3">
                {overview.tokenSavingPlan.map((item, index) => (
                  <div key={item} className="flex gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-700 shadow-sm">
                      {index + 1}
                    </div>
                    <p className="text-sm leading-6 text-slate-600">{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Globe2 className="h-4 w-4 text-slate-600" />
                우선 참고할 무료/오픈소스 소스
              </p>
              <div className="mt-4 grid gap-3">
                {overview.recommendedSources.map((source) => (
                  <a
                    key={source.name}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{source.name}</p>
                      <Badge variant="default">{source.license}</Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{source.fit}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{source.useFor}</p>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>명령 안전 정책</CardTitle>
            <CardDescription>
              10001.zip의 브릿지 명령 중 FlowFit에 바로 허용할 것과 차단할 것을 나눴습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview.policy.map((policy) => (
              <PolicyRow key={policy.name} policy={policy} />
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Gate 승인 대기</CardTitle>
              <CardDescription>
                폼 제출, 쿠키, 저장소, 탭 닫기 같은 CONFIRM 명령은 여기서 승인한 뒤에만 확장으로 전달됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {gateApprovals.length > 0 ? (
                gateApprovals.map((approval) => (
                  <div key={approval.approval_id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="warning">승인 필요</Badge>
                          <p className="font-semibold text-slate-950">{approval.command}</p>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{approval.risk_reason}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          만료 {formatDateTime(approval.expires_at)} · hash {approval.params_hash.slice(0, 12)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" onClick={() => reviewApproval(approval.approval_id, true)} disabled={loading}>
                          승인
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reviewApproval(approval.approval_id, false)}
                          disabled={loading}
                        >
                          거부
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
                  현재 승인 대기 중인 브라우저 명령이 없습니다.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>확장 세션</CardTitle>
              <CardDescription>확장 프로그램은 토큰으로만 로컬 엔진에 연결합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant={overview.extensionTokenConfigured ? "success" : "warning"}>
                  {overview.extensionTokenConfigured ? "브릿지 토큰 설정됨" : "개발 기본 토큰 사용 중"}
                </Badge>
                <Badge variant="default">엔진 {overview.engineBaseUrl}</Badge>
                <Badge variant="default">확인 {formatDateTime(overview.checkedAt)}</Badge>
              </div>

              {overview.error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  {overview.error}
                </div>
              ) : null}

              {overview.sessions.length > 0 ? (
                overview.sessions.map((session) => (
                  <div key={session.session_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={statusBadgeVariant(session.status)}>{statusLabel(session.status)}</Badge>
                      <p className="font-semibold text-slate-950">
                        {session.extension_name ?? "FlowFit Extension"}
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {session.browser ?? "browser"} {session.version ?? ""}
                    </p>
                    {session.active_tab_title ? (
                      <p className="mt-2 text-sm text-slate-500">{session.active_tab_title}</p>
                    ) : null}
                    {session.active_tab_url ? (
                      <p className="mt-1 break-all text-xs text-slate-400">{session.active_tab_url}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-400">마지막 연결 {formatDateTime(session.last_seen_at)}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
                  아직 연결된 브라우저 확장 세션이 없습니다. 현재 단계에서는 정책/큐/감사로그를 먼저 준비했고,
                  확장 프로그램은 이 엔진의 브릿지 엔드포인트로 붙이면 됩니다.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>최근 브라우저 작업 감사로그</CardTitle>
              <CardDescription>외부 사이트 조작은 실행 전후로 기록됩니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.commandAudit.length > 0 ? (
                overview.commandAudit.map((item) => <AuditRow key={item.command_id} item={item} />)
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
                  아직 기록된 브라우저 작업이 없습니다. 읽기 점검 버튼으로 안전한 GET_TEXT 명령을 큐에 넣어볼 수 있습니다.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {overview.connected ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
            ) : (
              <XCircle className="mt-0.5 h-5 w-5 text-amber-600" />
            )}
            <div>
              <p className="font-semibold text-slate-950">
                {overview.connected ? "브라우저 팔과 다리 준비됨" : "브라우저 브릿지 연결 대기 중"}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                다음 단계는 10001.zip 확장 소스에서 위험 명령을 이 정책 게이트 뒤로 연결하는 것입니다.
              </p>
            </div>
          </div>
          <Badge variant="info">policy v{overview.policyVersion}</Badge>
        </div>
      </div>
    </div>
  );
}
