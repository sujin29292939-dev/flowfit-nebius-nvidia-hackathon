"use client";

import { Copy, KeyRound, RotateCcw } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createFieldIntakeToken, getFieldIntakeAccessList } from "@/services/intakeAccessService";
import type { FieldIntakeAccess } from "@/types/flowfit";

export function IntakeAccessManager() {
  const [accessList, setAccessList] = React.useState<FieldIntakeAccess[]>([]);
  const [latestToken, setLatestToken] = React.useState("abc123");

  React.useEffect(() => {
    setAccessList(getFieldIntakeAccessList());
  }, []);

  const primary = accessList[0];
  const staffPortalLink = "http://localhost:3007/staff-intake";
  const tokenLink = `http://localhost:3007/intake/a-company/${latestToken}`;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">빠른 접수 링크</Badge>
              <Badge>업로드 전용</Badge>
            </div>
            <h2 className="mt-3 text-lg font-semibold text-slate-950">직원은 ID/비밀번호로 접수 전용 포털에 들어갑니다</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              직원용 포털은 관리자 앱과 독립되어 있고 업로드 권한만 갖습니다. 직원은 AI 판단, 대표 승인함, 회사 전체 기록을 볼 수 없습니다.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const created = createFieldIntakeToken("현장 직원");
              setLatestToken(created.token);
              setAccessList(getFieldIntakeAccessList());
            }}
          >
            <RotateCcw className="h-4 w-4" />
            토큰 재발급
          </Button>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
            <KeyRound className="h-3.5 w-3.5" />
            직원 접수 포털
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded-xl bg-white px-3 py-2 text-xs text-slate-700">{staffPortalLink}</code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(staffPortalLink);
              }}
            >
              <Copy className="h-4 w-4" />
              복사
            </Button>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-slate-500">토큰 링크도 유지</p>
          <code className="mt-2 block break-all rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">{tokenLink}</code>
        </div>

        {primary ? (
          <p className="mt-3 text-xs text-slate-500">
            직원 계정은 서버 환경변수로 관리하며, 비밀번호는 화면에 표시하지 않습니다. 회사 데이터 조회 권한: 없음
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
