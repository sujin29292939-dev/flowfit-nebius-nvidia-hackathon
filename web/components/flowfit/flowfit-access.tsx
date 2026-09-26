"use client";

import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { UserRole } from "@/types/flowfit";

const FLOWFIT_ROLE_KEY = "flowfit-ai-ops-role";

export function useFlowFitRole() {
  const [role, setRole] = React.useState<UserRole>("owner");

  React.useEffect(() => {
    const saved = window.localStorage.getItem(FLOWFIT_ROLE_KEY);
    if (saved === "owner" || saved === "manager" || saved === "employee" || saved === "ai") {
      setRole(saved);
    }
  }, []);

  const updateRole = React.useCallback((nextRole: UserRole) => {
    setRole(nextRole);
    window.localStorage.setItem(FLOWFIT_ROLE_KEY, nextRole);
  }, []);

  return { role, setRole: updateRole };
}

export function canUseAiOperations(role: UserRole) {
  return role === "owner" || role === "manager";
}

export function FlowFitRoleControl({ role, onChange }: { role: UserRole; onChange: (role: UserRole) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm">
      <span className="text-slate-500">권한</span>
      <Select
        value={role}
        onChange={(event) => onChange(event.target.value as UserRole)}
        className="h-8 w-[8.5rem] rounded-full border-0 bg-slate-50 px-3 py-1 shadow-none"
      >
        <option value="owner">대표</option>
        <option value="manager">관리자</option>
        <option value="employee">직원</option>
      </Select>
    </div>
  );
}

export function RestrictedEmployeeView() {
  return (
    <Card>
      <CardContent className="p-8 text-center">
        <p className="text-lg font-semibold text-slate-950">직원은 FlowFit 내부 AI 운영 화면에 접근할 수 없습니다</p>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
          직원은 기존 회사 메신저, 문자, 이메일 같은 외부 채널로 전달된 확인 요청에만 응답합니다. 대표와 AI의 대화,
          내부 판단, 다른 직원의 요청은 직원 화면에 표시하지 않습니다.
        </p>
      </CardContent>
    </Card>
  );
}
